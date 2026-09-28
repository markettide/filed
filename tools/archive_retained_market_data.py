"""Preserve retained Mongo market records in R2; dry-run unless --write.

Only reads redis_mirror. Never uses publishers, modifies TTLs, or sends alerts.
Content-addressed retained/ objects cannot replace live daily snapshots. Raw
source documents are preserved even when normalized reconstruction is invalid;
such days are reported as incomplete and make the command exit nonzero.
"""

import argparse
import datetime as dt
import gzip
import hashlib
import json
import os
import pathlib
import re
import sys
import uuid

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from r2_archive import configuration, encoded, _store as r2_store

DATASETS = {
    "announcements": ("day", "all", "count"),
    "insider-trading": ("insider",),
    "bulk-block": ("deals",),
}
KEY = re.compile(r"^mt:(day|all|count|insider|deals):(\d{4}-\d{2}-\d{2})(?::(?:parts|\d+))?$")
FIELDS = {"_id": 1, "value": 1, "source": 1, "updatedAt": 1, "expiresAt": 1}


class InvalidDay(ValueError):
    pass


def date_arg(value):
    return dt.date.fromisoformat(value).isoformat()


def plain(value):
    if isinstance(value, dt.datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=dt.timezone.utc)
        return value.astimezone(dt.timezone.utc).isoformat()
    if isinstance(value, dict):
        return {key: plain(item) for key, item in value.items()}
    if isinstance(value, list):
        return [plain(item) for item in value]
    return value


def inventory(collection, datasets, start=None, end=None):
    """Discover actual retained keys, not only dates in the live indexes."""
    found = set()
    for row in collection.find({"_id": {"$regex": KEY.pattern}}, {"_id": 1}):
        match = KEY.fullmatch(row["_id"])
        if not match:
            continue
        family, day = match.groups()
        try:
            date_arg(day)
        except ValueError:
            continue
        if (start and day < start) or (end and day > end):
            continue
        for dataset in datasets:
            if family in DATASETS[dataset]:
                found.add((dataset, day))
    return sorted(found)


def read_documents(collection, dataset, day):
    families = "|".join(DATASETS[dataset])
    pattern = rf"^mt:({families}):{re.escape(day)}(?::(?:parts|\d+))?$"
    rows = list(collection.find({"_id": {"$regex": pattern}}, FIELDS))
    return sorted((plain(row) for row in rows), key=lambda row: row["_id"])


def parse_value(values, key, expected):
    if key not in values:
        raise InvalidDay(f"Missing key: {key}")
    try:
        value = json.loads(values[key])
    except (TypeError, ValueError):
        raise InvalidDay(f"Invalid JSON: {key}") from None
    if not isinstance(value, expected):
        raise InvalidDay(f"Wrong value type: {key}")
    return value


def read_array(values, key, announcements=False):
    marker = values.get(key + ":parts")
    if marker is None:
        if any(k.startswith(key + ":") for k in values):
            raise InvalidDay(f"Missing part count: {key}")
        return parse_value(values, key, list)
    try:
        count = int(marker)
    except (TypeError, ValueError):
        raise InvalidDay(f"Invalid part count: {key}") from None
    if count < 0 or count > 10000:
        raise InvalidDay(f"Invalid part count: {key}")
    # Announcements: marker 1 means base blob. Trades: marker 0 means base.
    if count == 0 or (announcements and count == 1):
        return parse_value(values, key, list)
    result = []
    for index in range(count):
        result.extend(parse_value(values, f"{key}:{index}", list))
    return result


def snapshot(dataset, day, documents):
    """Keep exact values and metadata, including expired-but-not-yet-deleted rows."""
    values = {row["_id"]: row.get("value") for row in documents}
    errors = []
    payload = None
    counts = {}
    try:
        if not documents:
            raise InvalidDay("Source documents disappeared before export")
        if dataset == "announcements":
            important = read_array(values, f"mt:day:{day}", announcements=True)
            other = read_array(values, f"mt:all:{day}", announcements=True)
            if not all(isinstance(row, dict) for row in important + other):
                raise InvalidDay("Announcement rows must be JSON objects")
            stored_counts = parse_value(values, f"mt:count:{day}", dict)
            counts = {"important": len(important), "other": len(other)}
            if any(type(stored_counts.get(k)) is not int or stored_counts[k] != n
                   for k, n in counts.items()):
                raise InvalidDay("Announcement counts do not match reconstructed rows")
            payload = {"schema": 1, "day": day, "important": important,
                       "other": other, "counts": stored_counts}
        else:
            family = DATASETS[dataset][0]
            rows = read_array(values, f"mt:{family}:{day}")
            if not all(isinstance(row, dict) for row in rows):
                raise InvalidDay("Trade rows must be JSON objects")
            field = "trades" if dataset == "insider-trading" else "deals"
            counts = {field: len(rows)}
            payload = {"schema": 1, "day": day, field: rows}
    except InvalidDay as exc:
        errors.append(str(exc))
    return {
        "schema": 1, "dataset": dataset, "day": day,
        "source": "mongodb.redis_mirror", "sourceDocuments": documents,
        "complete": not errors, "validationErrors": errors,
        "rowCounts": counts, "normalized": payload,
    }


def read_object(client, bucket, key):
    try:
        response = client.get_object(Bucket=bucket, Key=key)
    except Exception as exc:
        # Access denied and network errors must not be mistaken for absence.
        code = getattr(exc, "response", {}).get("Error", {}).get("Code")
        if code in ("NoSuchKey", "404", "NotFound"):
            return None
        raise
    body = response["Body"]
    try:
        return body.read()
    finally:
        body.close()


def put_verified(client, bucket, key, payload):
    """Idempotent copy with byte/checksum and decoded-payload readback."""
    body = encoded(payload)
    old = read_object(client, bucket, key)
    existed = old is not None
    if existed and old != body:
        raise ValueError("Existing archive differs; refusing to overwrite it")
    if not existed:
        client.put_object(Bucket=bucket, Key=key, Body=body,
                          ContentType="application/json", ContentEncoding="gzip",
                          Metadata={"sha256": hashlib.sha256(body).hexdigest()})
    restored = read_object(client, bucket, key)
    if restored != body or json.loads(gzip.decompress(restored)) != payload:
        raise ValueError("Archive readback mismatch")
    return "already_verified" if existed else "copied_verified"


def export_retained(collection, datasets, start=None, end=None,
                    client=None, bucket=None, run_id=None):
    writing = client is not None
    report = {"schema": 1, "runId": run_id or uuid.uuid4().hex,
              "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
              "mode": "copy" if writing else "dry-run", "entries": []}
    for dataset, day in inventory(collection, datasets, start, end):
        entry = {"dataset": dataset, "day": day}
        try:
            docs = read_documents(collection, dataset, day)
            data = snapshot(dataset, day, docs)
            # Not a transaction across publisher writes: preserve raw docs and
            # reject observed movement. Never claim this is source completeness.
            if docs != read_documents(collection, dataset, day):
                raise InvalidDay("Source changed during capture; rerun this date")
            digest = hashlib.sha256(encoded(data)).hexdigest()
            key = f"retained/{dataset}/{day.replace('-', '/')}/{digest}.json.gz"
            entry.update(sourceDocuments=len(docs), complete=data["complete"],
                         validationErrors=data["validationErrors"],
                         rowCounts=data["rowCounts"], sha256=digest, objectKey=key)
            if not docs:
                raise InvalidDay("No retained source documents remain")
            entry["status"] = (put_verified(client, bucket, key, data)
                               if writing else "inventoried")
        except Exception as exc:
            entry["status"] = "failed"
            # Only our own safe validation messages; SDK errors may contain URIs.
            entry["error"] = str(exc) if isinstance(exc, InvalidDay) else type(exc).__name__
        report["entries"].append(entry)
        print(f"{dataset} {day}: {entry['status']} "
              f"complete={entry.get('complete', False)}", flush=True)
    report["ok"] = bool(report["entries"]) and all(
        e["status"] != "failed" and e.get("complete") for e in report["entries"])
    report["manifestKey"] = f"retained/manifests/{report['runId']}.json.gz" if writing else None
    if writing:
        try:
            put_verified(client, bucket, report["manifestKey"], report)
        except Exception as exc:
            # Preserve the local partial-progress report even when R2 fails.
            report["ok"] = False
            report["manifestError"] = type(exc).__name__
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--dataset", choices=["all", *DATASETS], default="all")
    parser.add_argument("--from-date", type=date_arg)
    parser.add_argument("--to-date", type=date_arg)
    parser.add_argument("--report", default="retained-archive-report.json")
    args = parser.parse_args()
    if args.from_date and args.to_date and args.from_date > args.to_date:
        parser.error("--from-date must not be after --to-date")
    if not os.environ.get("MONGODB_URI"):
        parser.error("MONGODB_URI is required")
    from pymongo import MongoClient
    client = MongoClient(os.environ["MONGODB_URI"], serverSelectionTimeoutMS=10000,
                         connectTimeoutMS=10000, socketTimeoutMS=60000, tz_aware=True)
    try:
        collection = client[os.environ.get("MONGODB_DB") or "market_tide"]["redis_mirror"]
        settings = configuration() if args.write else None
        report = export_retained(
            collection, list(DATASETS) if args.dataset == "all" else [args.dataset],
            args.from_date, args.to_date,
            r2_store() if args.write else None,
            settings["R2_BUCKET_NAME"] if settings else None)
        pathlib.Path(args.report).write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"Report: {args.report}; source MongoDB was not modified.")
        return 0 if report["ok"] else 1
    except Exception as exc:
        print(f"Retained-data export failed ({type(exc).__name__}); no MongoDB writes were made.")
        return 1
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(main())
