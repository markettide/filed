"""Copy Market Tide's durable Redis strings into MongoDB without deleting Redis.

Dry-run is the default. Pass ``--write`` only after reviewing the inventory.
The copier is idempotent: running it again updates the same MongoDB documents.
"""

import argparse
import datetime
import os
import sys

import requests
from pymongo import MongoClient, UpdateOne

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

PATTERNS = (
    "mt:index",
    "mt:meta",
    "mt:day:*",
    "mt:all:*",
    "mt:count:*",
    "mt:deals:*",
    "mt:insider:*",
    "mt:brief:*",
)


def redis_credentials():
    return (
        os.environ.get("KV_REST_API_URL") or os.environ.get("UPSTASH_REDIS_REST_URL"),
        os.environ.get("KV_REST_API_TOKEN") or os.environ.get("UPSTASH_REDIS_REST_TOKEN"),
    )


def redis(url, token, command):
    response = requests.post(
        url,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json=command,
        timeout=90,
    )
    response.raise_for_status()
    return response.json().get("result")


def scan(url, token, pattern):
    cursor = "0"
    while True:
        result = redis(url, token, ["SCAN", cursor, "MATCH", pattern, "COUNT", "500"])
        cursor, keys = result or ["0", []]
        yield from keys or []
        if str(cursor) == "0":
            break


def chunks(values, size=100):
    for start in range(0, len(values), size):
        yield values[start:start + size]


def migration_expiry(key, now):
    """Apply the same bounded retention used by the current publishers."""
    if key.startswith("mt:brief:"):
        return now + datetime.timedelta(days=60)
    if key.startswith(("mt:day:", "mt:all:", "mt:count:")):
        return now + datetime.timedelta(days=9)
    if key.startswith(("mt:deals:", "mt:insider:")):
        return now + datetime.timedelta(days=400)
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true", help="copy the inventoried values")
    parser.add_argument("--verify", action="store_true", help="compare copied values after writing")
    args = parser.parse_args()

    url, token = redis_credentials()
    mongo_uri = os.environ.get("MONGODB_URI")
    if not (url and token and mongo_uri):
        raise SystemExit("MONGODB_URI and Redis credentials are required")

    keys = sorted({key for pattern in PATTERNS for key in scan(url, token, pattern)})
    print(f"Redis market-data inventory: {len(keys)} string keys")
    if not args.write:
        print("Dry run only; nothing was written. Use --write to copy these keys.")
        return 0

    client = MongoClient(mongo_uri, serverSelectionTimeoutMS=6000, connectTimeoutMS=6000)
    collection = client[os.environ.get("MONGODB_DB") or "market_tide"]["redis_mirror"]
    collection.create_index("expiresAt", expireAfterSeconds=0)
    collection.create_index("updatedAt")
    copied = 0
    now = datetime.datetime.now(datetime.timezone.utc)

    for batch in chunks(keys):
        values = redis(url, token, ["MGET", *batch]) or []
        operations = []
        for key, value in zip(batch, values):
            if value is None:
                continue
            expiry = migration_expiry(key, now)
            fields = {"value": str(value), "updatedAt": now, "source": "migration"}
            if expiry is not None:
                fields["expiresAt"] = expiry
            update = {"$set": fields}
            if expiry is None:
                update["$unset"] = {"expiresAt": ""}
            operations.append(UpdateOne(
                {"_id": key},
                update,
                upsert=True,
            ))
        if operations:
            collection.bulk_write(operations, ordered=False)
            copied += len(operations)

    print(f"Copied {copied} keys into MongoDB redis_mirror; Redis was not changed.")

    if args.verify:
        mongo_count = collection.count_documents({"_id": {"$in": keys}})
        missing = []
        different = []
        verified = 0
        for batch in chunks(keys):
            redis_values = redis(url, token, ["MGET", *batch]) or []
            mongo_values = {
                row["_id"]: row.get("value")
                for row in collection.find({"_id": {"$in": batch}}, {"value": 1})
            }
            for key, redis_value in zip(batch, redis_values):
                if key not in mongo_values:
                    missing.append(key)
                elif str(redis_value) != mongo_values[key]:
                    different.append(key)
                else:
                    verified += 1
        print(
            f"Verification: {verified}/{len(keys)} values match exactly; "
            f"MongoDB contains {mongo_count}/{len(keys)} keys"
        )
        if missing:
            print(f"Missing keys: {', '.join(missing[:10])}")
        if different:
            print(f"Different values: {', '.join(different[:10])}")
        if missing or different:
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
