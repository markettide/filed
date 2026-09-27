"""Redis-shaped string storage implemented entirely in MongoDB.

The key/value/expiry shape is intentionally unchanged so the publishers and
website can complete the storage migration without rewriting every payload.
There is no network or runtime dependency on Redis in this module.
"""

import datetime
import os

_client = None
_collection = None


def configured():
    return bool(os.environ.get("MONGODB_URI"))


def _store():
    global _client, _collection
    if _collection is not None:
        return _collection

    from pymongo import MongoClient

    _client = MongoClient(
        os.environ["MONGODB_URI"],
        serverSelectionTimeoutMS=6000,
        connectTimeoutMS=6000,
    )
    database = _client[os.environ.get("MONGODB_DB") or "market_tide"]
    _collection = database["redis_mirror"]
    _collection.create_index("expiresAt", expireAfterSeconds=0)
    _collection.create_index("updatedAt")
    return _collection


def _expiry(command, now):
    """Return the absolute expiry represented by Redis SET options."""
    options = [str(value) for value in command[3:]]
    upper = [value.upper() for value in options]
    for name, milliseconds, absolute in (
        ("EX", False, False),
        ("PX", True, False),
        ("EXAT", False, True),
        ("PXAT", True, True),
    ):
        if name not in upper:
            continue
        position = upper.index(name)
        if position + 1 >= len(options):
            return None
        amount = float(options[position + 1])
        if milliseconds:
            amount /= 1000
        if absolute:
            return datetime.datetime.fromtimestamp(amount, datetime.timezone.utc)
        return now + datetime.timedelta(seconds=amount)
    return None


def mirror_command(command, source="publisher"):
    """Mirror a successful Redis SET or DEL command.

    Other commands are reads or transient operations and are intentionally
    ignored. The return value says whether MongoDB was changed.
    """
    if not configured() or not command:
        return False

    operation = str(command[0]).upper()
    if operation not in {"SET", "DEL"}:
        return False
    collection = _store()
    now = datetime.datetime.now(datetime.timezone.utc)

    if operation == "SET" and len(command) >= 3:
        expiry = _expiry(command, now)
        update = {
            "$set": {
                "value": str(command[2]),
                "updatedAt": now,
                "source": source,
            }
        }
        if expiry is None:
            update["$unset"] = {"expiresAt": ""}
        else:
            update["$set"]["expiresAt"] = expiry
        collection.update_one({"_id": str(command[1])}, update, upsert=True)
        return True

    if operation == "DEL" and len(command) >= 2:
        collection.delete_many({"_id": {"$in": [str(key) for key in command[1:]]}})
        return True

    return False


def read_command(command):
    """Read GET/MGET using Redis-compatible return values."""
    if not configured() or not command:
        return False, None
    operation = str(command[0]).upper()
    keys = ([str(command[1])] if operation == "GET" and len(command) >= 2
            else [str(key) for key in command[1:]] if operation == "MGET"
            else [])
    if not keys:
        return False, None
    now = datetime.datetime.now(datetime.timezone.utc)
    rows = _store().find(
        {
            "_id": {"$in": keys},
            "$or": [
                {"expiresAt": {"$exists": False}},
                {"expiresAt": {"$gt": now}},
            ],
        },
        {"value": 1},
    )
    values = {str(row["_id"]): row.get("value") for row in rows}
    result = [values.get(key) for key in keys]
    return True, result[0] if operation == "GET" else result


def execute(command, source="publisher"):
    """Execute the small Redis-compatible command subset in MongoDB.

    Publishers only use GET, MGET, SET and DEL. Keeping their return values
    compatible makes the final cutover small and, more importantly, preserves
    the already-migrated data in ``redis_mirror``.
    """
    if not configured():
        raise RuntimeError("MONGODB_URI is required")
    handled, result = read_command(command)
    if handled:
        return result
    operation = str(command[0]).upper() if command else ""
    if mirror_command(command, source):
        if operation == "SET":
            return "OK"
        if operation == "DEL":
            return max(0, len(command) - 1)
    raise ValueError(f"Unsupported MongoDB storage command: {operation or 'empty'}")
