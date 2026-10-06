"""Watchlist-news discovery and first-pass story clustering.

Phase 1 deliberately does not publish anything to the website.  It provides a
licensed-provider adapter, a stable article shape, deterministic duplicate
removal and an explicit queue for pairs that need an LLM decision in Phase 2.

Only publisher metadata supplied by the discovery provider is stored: title,
snippet, source, time and the original article URL.  Market Tide does not copy
or republish full publisher articles.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import os
import re
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import requests


GNEWS_SEARCH_URL = "https://gnews.io/api/v4/search"
TRACKING_PARAMS = {
    "fbclid", "gclid", "mc_cid", "mc_eid", "ref", "referrer",
    "utm_campaign", "utm_content", "utm_medium", "utm_source", "utm_term",
}
STOP_WORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
    "has", "have", "in", "is", "it", "its", "of", "on", "or", "that",
    "the", "this", "to", "was", "will", "with",
}


def utcnow():
    return dt.datetime.now(dt.timezone.utc)


def company_key(value):
    """Stable key used to join news to a watchlist company."""
    text = str(value or "").lower()
    text = re.sub(r"\b(limited|ltd|private|pvt|the|india|industries|company|co)\b", " ", text)
    return re.sub(r"[^a-z0-9]", "", text)


def canonical_url(value):
    """Remove fragments and common tracking parameters without changing content URLs."""
    text = str(value or "").strip()
    try:
        parsed = urlparse(text)
    except ValueError:
        return ""
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return ""
    host = parsed.netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    query = [
        (key, val) for key, val in parse_qsl(parsed.query, keep_blank_values=True)
        if key.lower() not in TRACKING_PARAMS and not key.lower().startswith("utm_")
    ]
    path = re.sub(r"/{2,}", "/", parsed.path or "/")
    if path != "/":
        path = path.rstrip("/")
    return urlunparse((parsed.scheme.lower(), host, path, "", urlencode(query), ""))


def clean_text(value):
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text


def _tokens(value):
    words = re.findall(r"[a-z0-9]+", str(value or "").lower())
    return {word for word in words if len(word) > 2 and word not in STOP_WORDS}


def _jaccard(left, right):
    a, b = _tokens(left), _tokens(right)
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def parse_time(value):
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        parsed = dt.datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc)


def article_id(url):
    return hashlib.sha256(canonical_url(url).encode("utf-8")).hexdigest()


def normalize_gnews_article(raw):
    """Convert GNews JSON into Market Tide's provider-neutral article shape."""
    url = canonical_url(raw.get("url"))
    if not url:
        return None
    source = raw.get("source") if isinstance(raw.get("source"), dict) else {}
    published = parse_time(raw.get("publishedAt"))
    return {
        "id": article_id(url),
        "title": clean_text(raw.get("title")),
        "description": clean_text(raw.get("description")),
        "url": url,
        "imageUrl": canonical_url(raw.get("image")),
        "sourceName": clean_text(source.get("name")) or urlparse(url).netloc,
        "sourceUrl": canonical_url(source.get("url")),
        "publishedAt": published,
        "provider": "gnews",
    }


def relevance(article, companies):
    """Return watchlist-company keys explicitly present in title/snippet."""
    haystack = clean_text(
        f"{article.get('title', '')} {article.get('description', '')}"
    ).lower()
    compact = company_key(haystack)
    matched = []
    for company in companies:
        key = company_key(company.get("name") or company.get("company"))
        ticker = re.sub(r"[^a-z0-9]", "", str(company.get("ticker") or "").lower())
        if key and key in compact:
            matched.append(key)
        elif ticker and len(ticker) >= 4 and re.search(rf"\b{re.escape(ticker)}\b", haystack):
            matched.append(key or ticker)
    return sorted(set(filter(None, matched)))


def similarity(left, right):
    """Weighted lexical score used before spending an LLM call."""
    title = _jaccard(left.get("title"), right.get("title"))
    description = _jaccard(left.get("description"), right.get("description"))
    return round(title * 0.72 + description * 0.28, 4)


def _within_hours(left, right, hours=72):
    a, b = left.get("publishedAt"), right.get("publishedAt")
    if not isinstance(a, dt.datetime) or not isinstance(b, dt.datetime):
        return True
    return abs((a - b).total_seconds()) <= hours * 3600


def _representative(articles):
    """Prefer the article with the richest useful preview, then the earliest report."""
    return sorted(
        articles,
        key=lambda row: (
            -(len(row.get("description") or "") + len(row.get("title") or "")),
            row.get("publishedAt") or dt.datetime.max.replace(tzinfo=dt.timezone.utc),
        ),
    )[0]


def _story(cluster, method):
    representative = _representative(cluster)
    urls = []
    sources = []
    company_keys = set()
    for article in cluster:
        company_keys.update(article.get("companyKeys") or [])
        if article.get("url") and article["url"] not in urls:
            urls.append(article["url"])
        source = {
            "name": article.get("sourceName") or "Unknown source",
            "url": article.get("url") or "",
        }
        if source not in sources:
            sources.append(source)
    seed = "|".join(sorted(article["id"] for article in cluster))
    return {
        "id": hashlib.sha256(seed.encode("utf-8")).hexdigest(),
        "companyKeys": sorted(company_keys),
        "title": representative.get("title") or "",
        "description": representative.get("description") or "",
        "url": representative.get("url") or "",
        "imageUrl": representative.get("imageUrl") or "",
        "publishedAt": representative.get("publishedAt"),
        "sources": sources,
        "sourceCount": len(sources),
        "articleIds": sorted(article["id"] for article in cluster),
        "dedupeMethod": method,
    }


def cluster_articles(articles):
    """Merge safe duplicates and return uncertain pairs for Phase 2 LLM review.

    Exact canonical URLs and very similar same-company stories are merged now.
    Borderline same-company stories remain separate and are placed in
    ``reviewPairs`` so Phase 2 can ask the existing LLM providers whether they
    describe the same real-world event.
    """
    rows = [dict(row) for row in articles if row.get("id") and row.get("url")]
    clusters = []
    methods = []
    review_pairs = []

    for row in rows:
        placed = False
        for index, cluster in enumerate(clusters):
            anchor = _representative(cluster)
            shared_companies = set(row.get("companyKeys") or []) & set(anchor.get("companyKeys") or [])
            if not shared_companies or not _within_hours(row, anchor):
                continue
            exact = row["url"] == anchor["url"] or row["id"] == anchor["id"]
            score = similarity(row, anchor)
            if exact or score >= 0.72:
                cluster.append(row)
                methods[index] = "exact" if exact else "heuristic"
                placed = True
                break
            # Deliberately broad: the same event is often rewritten with very
            # different headlines.  Phase 2 will spend an LLM call on this
            # narrow same-company, same-72-hour candidate set instead of
            # comparing every possible pair.
            if score >= 0.16:
                review_pairs.append({
                    "leftId": anchor["id"],
                    "rightId": row["id"],
                    "leftArticle": {
                        "id": anchor["id"],
                        "title": anchor.get("title") or "",
                        "description": anchor.get("description") or "",
                        "url": anchor.get("url") or "",
                        "sourceName": anchor.get("sourceName") or "",
                        "publishedAt": anchor.get("publishedAt"),
                    },
                    "rightArticle": {
                        "id": row["id"],
                        "title": row.get("title") or "",
                        "description": row.get("description") or "",
                        "url": row.get("url") or "",
                        "sourceName": row.get("sourceName") or "",
                        "publishedAt": row.get("publishedAt"),
                    },
                    "companyKeys": sorted(shared_companies),
                    "lexicalScore": score,
                    "reason": "same-company stories need an LLM event comparison",
                })
        if not placed:
            clusters.append([row])
            methods.append("single")

    return {
        "stories": [_story(cluster, methods[i]) for i, cluster in enumerate(clusters)],
        "reviewPairs": review_pairs,
    }


class GNewsSource:
    """Commercial-news discovery adapter; disabled without GNEWS_API_KEY."""

    def __init__(self, api_key=None, session=None):
        self.api_key = (api_key or os.environ.get("GNEWS_API_KEY") or "").strip()
        self.session = session or requests.Session()

    def configured(self):
        return bool(self.api_key)

    def search(self, companies, start, end, maximum=50):
        if not self.configured():
            raise RuntimeError("GNEWS_API_KEY is required for watchlist news discovery")
        names = [clean_text(row.get("name") or row.get("company")) for row in companies]
        names = [name for name in names if name]
        if not names:
            return []
        # One OR query serves up to five watchlist companies, avoiding one API
        # request per user/company and keeping provider costs bounded.
        query = " OR ".join(f'\"{name}\"' for name in names[:5])
        response = self.session.get(
            GNEWS_SEARCH_URL,
            params={
                "q": query,
                "lang": "en",
                "country": "in",
                "from": start.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
                "to": end.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
                "sortby": "publishedAt",
                "max": max(1, min(int(maximum), 100)),
                "apikey": self.api_key,
            },
            timeout=(5, 30),
        )
        response.raise_for_status()
        output = []
        for raw in (response.json() or {}).get("articles", []):
            article = normalize_gnews_article(raw)
            if not article:
                continue
            article["companyKeys"] = relevance(article, companies)
            if article["companyKeys"]:
                output.append(article)
        return output

