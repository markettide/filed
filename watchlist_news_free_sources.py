"""Zero-cost, permission-aware watchlist news sources.

This module deliberately fetches only an explicitly configured RSS/Atom feed.
It never follows article links or copies full publisher pages.  A feed cannot be
enabled until its commercial-use permission and terms URL have been recorded.
"""

from __future__ import annotations

import datetime as dt
import html
import os
import re
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from email.utils import parsedate_to_datetime
from urllib.parse import urlparse

import requests

from watchlist_news import (
    article_id,
    canonical_url,
    clean_text,
    cluster_articles,
    parse_time,
    relevance,
)


MAX_FEED_BYTES = 2_000_000
DEFAULT_USER_AGENT = "MarketTideNewsBot/1.0 (+https://markettide.in/contact)"
GDELT_DOC_URL = "https://api.gdeltproject.org/api/v2/doc/doc"
GDELT_TERMS_URL = "https://www.gdeltproject.org/about.html"


@dataclass(frozen=True)
class FeedPolicy:
    """Auditable permission record for one free news feed."""

    source_id: str
    source_name: str
    feed_url: str
    terms_url: str
    allowed_domains: tuple[str, ...]
    commercial_use_allowed: bool = False
    attribution_required: bool = True
    enabled: bool = False

    def validate(self):
        if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{1,63}", self.source_id):
            raise ValueError("source_id must be a short lowercase identifier")
        for label, value in (("feed_url", self.feed_url), ("terms_url", self.terms_url)):
            parsed = urlparse(value)
            if parsed.scheme != "https" or not parsed.netloc:
                raise ValueError(f"{label} must be an https URL")
        if not self.allowed_domains:
            raise ValueError("allowed_domains cannot be empty")
        if self.enabled and not self.commercial_use_allowed:
            raise ValueError(
                "A feed cannot be enabled until commercial-use permission is confirmed"
            )


def _local_name(tag):
    return str(tag).rsplit("}", 1)[-1].lower()


def _child_text(element, names):
    wanted = set(names)
    for child in list(element):
        if _local_name(child.tag) in wanted and child.text:
            return clean_text(child.text)
    return ""


def _entry_link(element):
    for child in list(element):
        if _local_name(child.tag) != "link":
            continue
        href = clean_text(child.attrib.get("href"))
        rel = clean_text(child.attrib.get("rel") or "alternate").lower()
        if href and rel in {"alternate", ""}:
            return href
        if child.text:
            return clean_text(child.text)
    return ""


def _plain_snippet(value, maximum=600):
    # RSS descriptions commonly contain small HTML fragments.  Keep text only;
    # scripts, images and publisher markup are never stored.
    text = html.unescape(str(value or ""))
    text = re.sub(r"<(script|style)\b[^>]*>.*?</\1>", " ", text, flags=re.I | re.S)
    text = re.sub(r"<[^>]+>", " ", text)
    text = clean_text(text)
    return text[:maximum]


def _published_at(value):
    parsed = parse_time(value)
    if parsed:
        return parsed
    try:
        parsed = parsedate_to_datetime(str(value or ""))
    except (TypeError, ValueError, OverflowError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc)


def parse_feed(payload, policy, companies, start, end):
    """Parse RSS 2.x or Atom XML into the existing provider-neutral shape."""
    policy.validate()
    if not policy.enabled:
        return []
    if len(payload) > MAX_FEED_BYTES:
        raise ValueError("Feed exceeds the configured two-megabyte safety limit")
    try:
        root = ET.fromstring(payload)
    except ET.ParseError as exc:
        raise ValueError("Feed returned invalid XML") from exc

    output = []
    for entry in root.iter():
        if _local_name(entry.tag) not in {"item", "entry"}:
            continue
        title = _plain_snippet(_child_text(entry, {"title"}), maximum=300)
        description = _plain_snippet(
            _child_text(entry, {"description", "summary", "content"})
        )
        link = canonical_url(_entry_link(entry))
        published = _published_at(
            _child_text(entry, {"pubdate", "published", "updated", "date"})
        )
        if not title or not link or not published or published < start or published > end:
            continue
        domain = (urlparse(link).hostname or "").lower()
        if not any(domain == allowed or domain.endswith(f".{allowed}")
                   for allowed in policy.allowed_domains):
            continue
        article = {
            "id": article_id(link),
            "title": title,
            "description": description,
            "url": link,
            "imageUrl": "",
            "sourceName": policy.source_name,
            "sourceUrl": canonical_url(policy.feed_url),
            "publishedAt": published,
            "provider": f"rss:{policy.source_id}",
            "termsUrl": policy.terms_url,
            "attributionRequired": policy.attribution_required,
        }
        article["companyKeys"] = relevance(article, companies)
        if article["companyKeys"]:
            output.append(article)
    return output


class PermittedFeedSource:
    """Conditional HTTP client for a single approved feed."""

    def __init__(self, policy, session=None, user_agent=DEFAULT_USER_AGENT):
        policy.validate()
        self.policy = policy
        self.session = session or requests.Session()
        self.user_agent = user_agent

    def fetch(self, companies, start, end, cache=None):
        if not self.policy.enabled:
            return {"articles": [], "disabled": True, "cache": cache or {}}
        cache = dict(cache or {})
        headers = {
            "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml",
            "User-Agent": self.user_agent,
        }
        if cache.get("etag"):
            headers["If-None-Match"] = cache["etag"]
        if cache.get("lastModified"):
            headers["If-Modified-Since"] = cache["lastModified"]
        response = self.session.get(
            self.policy.feed_url,
            headers=headers,
            timeout=(5, 20),
        )
        if response.status_code == 304:
            return {"articles": [], "notModified": True, "cache": cache}
        response.raise_for_status()
        payload = response.content
        if len(payload) > MAX_FEED_BYTES:
            raise ValueError("Feed exceeds the configured two-megabyte safety limit")
        next_cache = {
            "etag": response.headers.get("ETag") or cache.get("etag") or "",
            "lastModified": (
                response.headers.get("Last-Modified") or cache.get("lastModified") or ""
            ),
        }
        return {
            "articles": parse_feed(payload, self.policy, companies, start, end),
            "notModified": False,
            "cache": next_cache,
        }


def _gdelt_time(value):
    try:
        return dt.datetime.strptime(
            str(value or ""), "%Y%m%dT%H%M%SZ"
        ).replace(tzinfo=dt.timezone.utc)
    except ValueError:
        return None


def normalize_gdelt_article(raw, companies, start, end):
    """Normalize GDELT metadata without downloading the publisher article."""
    url = canonical_url(raw.get("url"))
    title = _plain_snippet(raw.get("title"), maximum=300)
    published = _gdelt_time(raw.get("seendate"))
    if not url or not title or not published or published < start or published > end:
        return None
    language = clean_text(raw.get("language")).lower()
    if language and language != "english":
        return None
    domain = clean_text(raw.get("domain")) or (urlparse(url).hostname or "")
    article = {
        "id": article_id(url),
        "title": title,
        "description": "",
        "url": url,
        "imageUrl": canonical_url(raw.get("socialimage")),
        "sourceName": domain,
        "sourceUrl": canonical_url(f"https://{domain}") if domain else "",
        "publishedAt": published,
        "provider": "gdelt",
        "termsUrl": GDELT_TERMS_URL,
        "attributionRequired": True,
        "providerAttribution": "News discovery data provided by The GDELT Project",
    }
    article["companyKeys"] = relevance(article, companies)
    return article if article["companyKeys"] else None


class GDELTSource:
    """Free commercial-use news discovery through GDELT DOC 2.0."""

    source_id = "gdelt"

    def __init__(
        self,
        session=None,
        maximum=25,
        max_batches=None,
        source_country="IN",
        request_interval_seconds=6.0,
        sleeper=None,
    ):
        self.session = session or requests.Session()
        self.maximum = max(1, min(int(maximum), 250))
        self.max_batches = max(1, min(int(
            max_batches or os.environ.get("WATCHLIST_NEWS_MAX_GDELT_BATCHES", 10)
        ), 20))
        self.source_country = re.sub(r"[^A-Za-z]", "", source_country or "").upper()[:2]
        self.request_interval_seconds = max(0.0, min(float(request_interval_seconds), 5.0))
        self.sleeper = sleeper or time.sleep

    def fetch(self, companies, start, end, cache=None):
        articles = []
        errors = []
        cache = dict(cache or {})
        names = [clean_text(row.get("name") or row.get("company")) for row in companies]
        names = [name for name in names if name]
        if not names:
            return {
                "articles": [],
                "notModified": False,
                "cache": {**cache, "lastRunAt": end.isoformat()},
                "errors": [],
            }
        try:
            start_index = int(cache.get("nextCompanyIndex") or 0) % len(names)
        except (TypeError, ValueError):
            start_index = 0
        count = min(len(names), self.max_batches)
        selected = [names[(start_index + index) % len(names)] for index in range(count)]
        # Each selected company gets its own result page; the persisted cursor
        # rotates across the global list over subsequent hourly runs.
        for index, name in enumerate(selected):
            if index and self.request_interval_seconds:
                self.sleeper(self.request_interval_seconds)
            query = f'\"{name}\"'
            if self.source_country:
                query += f" sourcecountry:{self.source_country}"
            request = {
                "params": {
                    "query": query,
                    "mode": "artlist",
                    "maxrecords": self.maximum,
                    "format": "json",
                    "sort": "datedesc",
                    "startdatetime": start.astimezone(dt.timezone.utc).strftime("%Y%m%d%H%M%S"),
                    "enddatetime": end.astimezone(dt.timezone.utc).strftime("%Y%m%d%H%M%S"),
                },
                "headers": {"User-Agent": DEFAULT_USER_AGENT, "Accept": "application/json"},
                "timeout": (20, 60),
            }
            try:
                response = self.session.get(GDELT_DOC_URL, **request)
                if response.status_code == 429:
                    try:
                        retry_after = float(response.headers.get("Retry-After") or 12)
                    except (TypeError, ValueError):
                        retry_after = 12
                    self.sleeper(max(6.0, min(retry_after, 30.0)))
                    response = self.session.get(GDELT_DOC_URL, **request)
                response.raise_for_status()
            except requests.RequestException as exc:
                errors.append({"company": name, "error": str(exc)[:500]})
                continue
            for raw in (response.json() or {}).get("articles", []):
                article = normalize_gdelt_article(raw, companies, start, end)
                if article:
                    articles.append(article)
        unique = {row["id"]: row for row in articles}
        return {
            "articles": list(unique.values()),
            "notModified": False,
            "cache": {
                "lastRunAt": end.isoformat(),
                "nextCompanyIndex": (start_index + count) % len(names),
            },
            "errors": errors,
        }


def discover_from_free_feeds(sources, companies, start, end, caches=None):
    """Fetch approved feeds once, then reuse Phase 1 duplicate clustering."""
    caches = dict(caches or {})
    articles = []
    next_caches = {}
    errors = []
    for source in sources:
        source_id = getattr(source, "source_id", None)
        if not source_id:
            source_id = source.policy.source_id
        try:
            result = source.fetch(
                companies,
                start,
                end,
                cache=caches.get(source_id),
            )
            articles.extend(result.get("articles", []))
            next_caches[source_id] = result.get("cache", {})
            for error in result.get("errors") or []:
                errors.append({"sourceId": source_id, **error})
        except (requests.RequestException, ValueError) as exc:
            errors.append({"sourceId": source_id, "error": str(exc)})
    clustered = cluster_articles(articles)
    clustered["sourceCaches"] = next_caches
    clustered["sourceErrors"] = errors
    clustered["articleCount"] = len(articles)
    return clustered

