"""MongoDB persistence for watchlist news stories and pending LLM reviews."""

from __future__ import annotations

import datetime as dt
import hashlib
import os


RETENTION_DAYS = 14
VISIBLE_DAYS = 7
_client = None
_database = None


def configured():
    return bool(os.environ.get("MONGODB_URI"))


def _db():
    global _client, _database
    if _database is not None:
        return _database
    if not configured():
        raise RuntimeError("MONGODB_URI is required")
    from pymongo import ASCENDING, DESCENDING, MongoClient

    _client = MongoClient(
        os.environ["MONGODB_URI"],
        serverSelectionTimeoutMS=6000,
        connectTimeoutMS=6000,
    )
    _database = _client[os.environ.get("MONGODB_DB") or "market_tide"]
    stories = _database["watchlist_news_stories"]
    stories.create_index([("companyKeys", ASCENDING), ("publishedAt", DESCENDING)])
    stories.create_index("expiresAt", expireAfterSeconds=0)
    reviews = _database["watchlist_news_reviews"]
    reviews.create_index([("status", ASCENDING), ("createdAt", ASCENDING)])
    reviews.create_index("expiresAt", expireAfterSeconds=0)
    return _database


def save_discovery(result, now=None):
    """Idempotently store deterministic stories and the Phase 2 review queue."""
    now = now or dt.datetime.now(dt.timezone.utc)
    expiry = now + dt.timedelta(days=RETENTION_DAYS)
    database = _db()
    for story in result.get("stories", []):
        database["watchlist_news_stories"].update_one(
            {"_id": story["id"]},
            {
                "$set": {**story, "updatedAt": now, "expiresAt": expiry},
                "$setOnInsert": {"createdAt": now},
            },
            upsert=True,
        )
    for pair in result.get("reviewPairs", []):
        review_id = ":".join(sorted((pair["leftId"], pair["rightId"])))
        database["watchlist_news_reviews"].update_one(
            {"_id": review_id},
            {
                "$set": {
                    **pair,
                    "updatedAt": now,
                    "expiresAt": expiry,
                },
                "$setOnInsert": {
                    "createdAt": now,
                    "attempts": 0,
                    "status": "pending",
                },
            },
            upsert=True,
        )


def load_source_caches():
    row = _db()["watchlist_news_runtime"].find_one({"_id": "source-caches"}) or {}
    return row.get("caches") or {}


def save_source_caches(caches, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    _db()["watchlist_news_runtime"].update_one(
        {"_id": "source-caches"},
        {"$set": {"caches": dict(caches or {}), "updatedAt": now}},
        upsert=True,
    )


def record_ingestion_run(summary, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    _db()["watchlist_news_runtime"].update_one(
        {"_id": "last-ingestion"},
        {"$set": {**dict(summary or {}), "updatedAt": now}},
        upsert=True,
    )


def claim_pending_review(now=None, lease_seconds=300):
    """Lease one review so overlapping scheduled jobs cannot process it twice."""
    now = now or dt.datetime.now(dt.timezone.utc)
    stale = now - dt.timedelta(seconds=max(60, int(lease_seconds)))
    from pymongo import ReturnDocument

    return _db()["watchlist_news_reviews"].find_one_and_update(
        {
            "$or": [
                {"status": "pending"},
                {"status": "processing", "claimedAt": {"$lt": stale}},
            ]
        },
        {"$set": {"status": "processing", "claimedAt": now, "updatedAt": now}},
        sort=[("createdAt", 1)],
        return_document=ReturnDocument.AFTER,
    )


def release_review(review_id, error, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    _db()["watchlist_news_reviews"].update_one(
        {"_id": review_id, "status": "processing"},
        {
            "$set": {
                "status": "pending",
                "lastError": str(error)[:500],
                "updatedAt": now,
            },
            "$unset": {"claimedAt": ""},
            "$inc": {"attempts": 1},
        },
    )


def _merge_story_documents(left, right, method="llm"):
    articles = sorted(set((left.get("articleIds") or []) + (right.get("articleIds") or [])))
    sources = []
    for source in (left.get("sources") or []) + (right.get("sources") or []):
        if source not in sources:
            sources.append(source)
    representative = max(
        (left, right),
        key=lambda row: len(row.get("title") or "") + len(row.get("description") or ""),
    )
    published = [row.get("publishedAt") for row in (left, right) if row.get("publishedAt")]
    return {
        "_id": hashlib.sha256("|".join(articles).encode("utf-8")).hexdigest(),
        "companyKeys": sorted(set(
            (left.get("companyKeys") or []) + (right.get("companyKeys") or [])
        )),
        "title": representative.get("title") or "",
        "description": representative.get("description") or "",
        "url": representative.get("url") or "",
        "imageUrl": representative.get("imageUrl") or "",
        "publishedAt": min(published) if published else None,
        "sources": sources,
        "sourceCount": len(sources),
        "articleIds": articles,
        "dedupeMethod": method,
    }


def complete_review(review, decision, now=None):
    """Persist the audit decision and atomically publish a merged story first."""
    now = now or dt.datetime.now(dt.timezone.utc)
    database = _db()
    review_id = review["_id"]
    if decision.get("sameEvent"):
        left = database["watchlist_news_stories"].find_one(
            {"articleIds": review["leftId"]}
        )
        right = database["watchlist_news_stories"].find_one(
            {"articleIds": review["rightId"]}
        )
        if left and right and left["_id"] != right["_id"]:
            merged = _merge_story_documents(left, right)
            merged["updatedAt"] = now
            merged["expiresAt"] = max(left.get("expiresAt", now), right.get("expiresAt", now))
            merged["createdAt"] = min(left.get("createdAt", now), right.get("createdAt", now))
            # Upsert the merged document before removing the two old documents,
            # so readers can never observe both source stories disappearing.
            database["watchlist_news_stories"].replace_one(
                {"_id": merged["_id"]}, merged, upsert=True
            )
            database["watchlist_news_stories"].delete_many(
                {"_id": {"$in": [left["_id"], right["_id"]], "$ne": merged["_id"]}}
            )
    database["watchlist_news_reviews"].update_one(
        {"_id": review_id, "status": "processing"},
        {
            "$set": {
                "status": "completed",
                "sameEvent": bool(decision.get("sameEvent")),
                "confidence": float(decision.get("confidence") or 0),
                "decisionReason": str(decision.get("reason") or "")[:500],
                "model": str(decision.get("model") or "")[:100],
                "completedAt": now,
                "updatedAt": now,
            },
            "$unset": {"claimedAt": "", "lastError": ""},
        },
    )
    return decision


def recent_for_companies(keys, now=None, days=VISIBLE_DAYS, limit=200):
    now = now or dt.datetime.now(dt.timezone.utc)
    start = now - dt.timedelta(days=max(1, min(int(days), VISIBLE_DAYS)))
    return list(
        _db()["watchlist_news_stories"].find(
            {
                "companyKeys": {"$in": list(keys)},
                "publishedAt": {"$gte": start, "$lte": now},
            }
        ).sort("publishedAt", -1).limit(max(1, min(int(limit), 500)))
    )

