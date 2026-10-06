"""Scheduled Phase 2 entry point.

The job is inert unless WATCHLIST_NEWS_ENABLED=1.  Sources must also be enabled
individually in watchlist_news_sources.json after their permissions are checked.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from watchlist_news import company_key
from watchlist_news_free_sources import FeedPolicy, GDELTSource, PermittedFeedSource
from watchlist_news_phase2 import OpenAICompatibleEventReviewer, run_ingestion
from watchlist_news_store import _db


ROOT = Path(__file__).resolve().parent


def load_sources(path=None):
    path = Path(path or os.environ.get("WATCHLIST_NEWS_SOURCES_FILE") or (
        ROOT / "watchlist_news_sources.json"
    ))
    raw = json.loads(path.read_text(encoding="utf-8"))
    output = []
    gdelt = (raw.get("providers") or {}).get("gdelt") or {}
    if gdelt.get("enabled") is True:
        if gdelt.get("commercialUseAllowed") is not True or not gdelt.get("termsUrl"):
            raise ValueError("GDELT requires a recorded terms URL and commercial-use approval")
        output.append(GDELTSource(
            maximum=gdelt.get("maximumPerCompany") or 25,
            max_batches=gdelt.get("maxBatches") or 10,
            source_country=gdelt.get("sourceCountry") or "IN",
            request_interval_seconds=gdelt.get("requestIntervalSeconds") or 6.0,
        ))
    for row in raw.get("sources") or []:
        policy = FeedPolicy(
            source_id=row.get("id") or "",
            source_name=row.get("name") or "",
            feed_url=row.get("feedUrl") or "",
            terms_url=row.get("termsUrl") or "",
            allowed_domains=tuple(row.get("allowedDomains") or []),
            commercial_use_allowed=row.get("commercialUseAllowed") is True,
            attribution_required=row.get("attributionRequired") is not False,
            enabled=row.get("enabled") is True,
        )
        policy.validate()
        if policy.enabled:
            output.append(PermittedFeedSource(policy))
    return output


def _extract_company(value):
    if not isinstance(value, dict):
        return None
    name = str(value.get("name") or value.get("company") or value.get("companyName") or "").strip()
    ticker = str(value.get("ticker") or value.get("symbol") or "").strip().upper()
    if not name:
        return None
    return {"name": name, "ticker": ticker}


def load_companies(database=None):
    """Read unique companies globally so news is fetched once for every user."""
    override = os.environ.get("WATCHLIST_NEWS_COMPANIES_JSON")
    if override:
        candidates = json.loads(override)
    else:
        if database is None:
            database = _db()
        candidates = []
        for row in database["users"].find(
            {}, {"portfolio": 1, "watchlist": 1, "watchlistCompanies": 1, "companies": 1}
        ):
            # The live website stores watchlist rows under `portfolio`.
            # Retain the older aliases so this collector can also read data
            # created by earlier deployments without a destructive migration.
            for field in ("portfolio", "watchlist", "watchlistCompanies", "companies"):
                candidates.extend(row.get(field) or [])
        for row in database["watchlists"].find({}, {"companies": 1, "items": 1}):
            candidates.extend(row.get("companies") or row.get("items") or [])
    unique = {}
    for value in candidates:
        company = _extract_company(value)
        if company:
            unique[company_key(company["name"])] = company
    return sorted(unique.values(), key=lambda row: row["name"].lower())


def main():
    if os.environ.get("WATCHLIST_NEWS_ENABLED") != "1":
        print(json.dumps({"enabled": False, "reason": "WATCHLIST_NEWS_ENABLED is not 1"}))
        return 0
    sources = load_sources()
    companies = load_companies()
    summary = run_ingestion(
        sources,
        companies,
        reviewer=OpenAICompatibleEventReviewer(),
    )
    print(json.dumps({"enabled": True, **summary}, default=str))
    return 0 if not summary.get("sourceErrors") else 2


if __name__ == "__main__":
    raise SystemExit(main())

