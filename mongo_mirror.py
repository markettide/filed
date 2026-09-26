"""Mirror Redis string writes into MongoDB during the storage migration.

Redis remains the source of truth until the read-side cut-over is verified.
This module only copies SET/DEL mutations into an isolated ``redis_mirror``
collection, preserving the key, value and expiry time.
"""

import datetime
import os
import sys

_client = None
_collection = None
_warned = False


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


def mirror_safely(command, source="publisher"):
    """Mirror without risking the still-live Redis publishing path.

    Set MONGO_MIRROR_REQUIRED=1 after verification to make a MongoDB mirror
    failure fail the publisher instead of warning once and continuing.
    """
    global _warned
    try:
        return mirror_command(command, source)
    except Exception as error:
        if os.environ.get("MONGO_MIRROR_REQUIRED") == "1":
            raise
        if not _warned:
            print(
                f"MongoDB mirror unavailable ({type(error).__name__}); Redis publish continues",
                file=sys.stderr,
            )
            _warned = True
        return False
