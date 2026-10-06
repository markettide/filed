"""Bounded LLM review and Phase 2 watchlist-news ingestion orchestration."""

from __future__ import annotations

import datetime as dt
import json
import os
from urllib.parse import urlparse

import requests


KNOWN_LLM_HOSTS = {"api.groq.com", "openrouter.ai"}
DEFAULT_MAX_REVIEWS = 20


def _clamp_confidence(value):
    try:
        return max(0.0, min(float(value), 1.0))
    except (TypeError, ValueError):
        return 0.0


def parse_llm_decision(value, model=""):
    """Strictly normalize the model response; uncertain output never merges."""
    if isinstance(value, str):
        text = value.strip()
        if text.startswith("```"):
            text = text.strip("`")
            if text.lower().startswith("json"):
                text = text[4:].lstrip()
        value = json.loads(text)
    if not isinstance(value, dict):
        raise ValueError("LLM decision must be a JSON object")
    same = value.get("same_event")
    confidence = _clamp_confidence(value.get("confidence"))
    reason = str(value.get("reason") or "").strip()[:500]
    # A low-confidence yes is deliberately treated as no. False separation is
    # preferable to hiding two genuinely different market events.
    return {
        "sameEvent": same is True and confidence >= 0.80,
        "confidence": confidence,
        "reason": reason,
        "model": model,
    }


class OpenAICompatibleEventReviewer:
    """Small JSON-only comparison using an already configured LLM account."""

    def __init__(self, api_key=None, endpoint=None, model=None, session=None):
        self.api_key = (api_key or os.environ.get("WATCHLIST_NEWS_LLM_API_KEY") or "").strip()
        self.endpoint = (
            endpoint or os.environ.get("WATCHLIST_NEWS_LLM_ENDPOINT") or ""
        ).strip()
        self.model = (model or os.environ.get("WATCHLIST_NEWS_LLM_MODEL") or "").strip()
        self.session = session or requests.Session()

    def configured(self):
        if not self.api_key or not self.endpoint or not self.model:
            return False
        parsed = urlparse(self.endpoint)
        return parsed.scheme == "https" and parsed.hostname in KNOWN_LLM_HOSTS

    def review(self, pair):
        if not self.configured():
            raise RuntimeError("Watchlist-news LLM reviewer is not configured")
        left = pair.get("leftArticle") or {}
        right = pair.get("rightArticle") or {}
        prompt = {
            "task": "Decide whether these headlines describe the same real-world event.",
            "rules": [
                "Use only the supplied headline, snippet, source and time.",
                "Same company alone is not enough.",
                "Earnings, appointments, orders and acquisitions are separate unless clearly identical.",
                "Return JSON only with same_event, confidence and reason.",
            ],
            "article_a": left,
            "article_b": right,
        }
        response = self.session.post(
            self.endpoint,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "User-Agent": "MarketTideNewsBot/1.0",
            },
            json={
                "model": self.model,
                "temperature": 0,
                "max_tokens": 180,
                "response_format": {"type": "json_object"},
                "messages": [
                    {
                        "role": "system",
                        "content": "You compare news metadata. Never infer facts not present in the input.",
                    },
                    {"role": "user", "content": json.dumps(prompt, default=str)},
                ],
            },
            timeout=(5, 30),
        )
        response.raise_for_status()
        body = response.json()
        content = body["choices"][0]["message"]["content"]
        return parse_llm_decision(content, model=self.model)


def process_pending_reviews(reviewer=None, maximum=None, services=None):
    """Process a capped queue. Failures are released for a later retry."""
    if reviewer is None:
        reviewer = OpenAICompatibleEventReviewer()
    maximum = maximum if maximum is not None else os.environ.get(
        "WATCHLIST_NEWS_MAX_LLM_REVIEWS", DEFAULT_MAX_REVIEWS
    )
    maximum = max(0, min(int(maximum), 100))
    if not reviewer.configured() or maximum == 0:
        return {"processed": 0, "merged": 0, "failed": 0, "skipped": True}
    if services is None:
        from watchlist_news_store import claim_pending_review, complete_review, release_review

        services = {
            "claim": claim_pending_review,
            "complete": complete_review,
            "release": release_review,
        }
    counts = {"processed": 0, "merged": 0, "failed": 0, "skipped": False}
    for _ in range(maximum):
        review = services["claim"]()
        if not review:
            break
        try:
            decision = reviewer.review(review)
            services["complete"](review, decision)
            counts["processed"] += 1
            counts["merged"] += int(decision["sameEvent"])
        except (requests.RequestException, KeyError, TypeError, ValueError, RuntimeError) as exc:
            services["release"](review["_id"], exc)
            counts["failed"] += 1
    return counts


def run_ingestion(sources, companies, now=None, reviewer=None, services=None):
    """Fetch once, persist, review uncertain pairs and record a health summary."""
    from watchlist_news_free_sources import discover_from_free_feeds

    if services is None:
        from watchlist_news_store import (
            load_source_caches,
            record_ingestion_run,
            save_discovery,
            save_source_caches,
        )

        services = {
            "loadCaches": load_source_caches,
            "saveCaches": save_source_caches,
            "saveDiscovery": save_discovery,
            "recordRun": record_ingestion_run,
        }
    now = now or dt.datetime.now(dt.timezone.utc)
    result = discover_from_free_feeds(
        sources,
        companies,
        now - dt.timedelta(days=7),
        now,
        caches=services["loadCaches"](),
    )
    services["saveDiscovery"](result, now=now)
    services["saveCaches"](result.get("sourceCaches") or {}, now=now)
    review = process_pending_reviews(reviewer=reviewer)
    summary = {
        "companyCount": len(companies),
        "sourceCount": len(sources),
        "articleCount": result.get("articleCount", 0),
        "storyCount": len(result.get("stories") or []),
        "pendingReviewCount": len(result.get("reviewPairs") or []),
        "sourceErrors": result.get("sourceErrors") or [],
        "llm": review,
    }
    services["recordRun"](summary, now=now)
    return summary

