"""Permanent, compressed market-data archives in Cloudflare R2.

MongoDB remains the live application store.  R2 is deliberately a second,
append-by-date copy so a failed archive upload can never stop a scrape or
replace the data the website is currently serving.
"""

import datetime
import gzip
import json
import os


REQUIRED_ENV = (
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET_NAME",
)

_client = None


def configured():
    return all(os.environ.get(name) for name in REQUIRED_ENV)


def _store():
    global _client
    if _client is not None:
        return _client

    import boto3
    from botocore.config import Config

    account_id = os.environ["R2_ACCOUNT_ID"].strip()
    _client = boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
        config=Config(signature_version="s3v4"),
    )
    return _client


def object_key(kind, day):
    """Return a predictable key such as announcements/2026/09/27.json.gz."""
    parsed = datetime.date.fromisoformat(str(day))
    return f"{kind}/{parsed:%Y/%m/%d}.json.gz"


def encoded(payload):
    """Canonical gzip bytes; mtime=0 keeps identical uploads identical."""
    raw = json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return gzip.compress(raw, compresslevel=9, mtime=0)


def archive_json(kind, day, payload, log=print):
    """Upload one day's snapshot, without making publication depend on R2."""
    if not configured():
        return False

    key = f"{kind}/{day}.json.gz"
    try:
        key = object_key(kind, day)
        body = encoded(payload)
        _store().put_object(
            Bucket=os.environ["R2_BUCKET_NAME"],
            Key=key,
            Body=body,
            ContentType="application/json",
            ContentEncoding="gzip",
            CacheControl="private, max-age=300",
            Metadata={"schema": "1", "day": str(day), "kind": str(kind)},
        )
        log(f"  R2 archive: {key} ({len(body):,} compressed bytes)")
        return True
    except Exception as exc:
        # The primary MongoDB write has already succeeded.  A Cloudflare or
        # credential problem must be visible in the log, but must not discard
        # the fresh dashboard data.
        log(f"  R2 archive warning: {key} was not uploaded "
            f"({type(exc).__name__}: {exc})")
        return False
