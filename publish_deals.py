"""
Put bulk and block deals where the website can read them.

Same storage shape as publish_insider, for the same reason - one service, one
shape to understand:

    mt:deals:2026-09-11        the day's deals, as JSON
    mt:deals:2026-09-11:parts  how many pieces it was split into
    mt:deals:index             the days held, newest first
    mt:deals:meta              when it last ran, and what it found

ACCUMULATES rather than replaces. NSE answers for a date range, but BSE only
ever hands over its latest trading day whatever dates it is asked for - so
BSE history exists only because every pass keeps what the last one found.
That is also why a pass that finds nothing must never write an empty day.

    python publish_deals.py                # the last 7 days, write it
    python publish_deals.py --dry-run      # print it instead
    python publish_deals.py --days 30      # a wider window
"""

import argparse
import datetime
import json
import os

import requests

import deals
from mongo_mirror import mirror_safely

TTL_DAYS = 400
TTL_SECONDS = TTL_DAYS * 24 * 3600
MAX_BYTES = 900_000
KEEP_DAYS = 90
DEFAULT_DAYS = 7


def creds():
    url = (os.environ.get("KV_REST_API_URL")
           or os.environ.get("UPSTASH_REDIS_REST_URL"))
    tok = (os.environ.get("KV_REST_API_TOKEN")
           or os.environ.get("UPSTASH_REDIS_REST_TOKEN"))
    return url, tok


def redis(url, token, command):
    r = requests.post(url, headers={"Authorization": f"Bearer {token}",
                                    "Content-Type": "application/json"},
                      json=command, timeout=60)
    r.raise_for_status()
    result = r.json().get("result")
    mirror_safely(command, "deals")
    return result


def read_day(url, token, key):
    """Whatever is already stored for this day, across however many parts."""
    try:
        parts = int(redis(url, token, ["GET", f"{key}:parts"]) or 0)
    except (TypeError, ValueError):
        parts = 0
    if not parts:
        raw = redis(url, token, ["GET", key])
        try:
            return json.loads(raw) if raw else []
        except Exception:
            return []

    rows = []
    for i in range(parts):
        raw = redis(url, token, ["GET", f"{key}:{i}"])
        if not raw:
            continue
        try:
            rows.extend(json.loads(raw))
        except Exception:
            pass
    return rows


def write_day(url, token, key, rows):
    """One day's deals, split if they will not fit in a single request."""
    blob = json.dumps(rows, ensure_ascii=False)
    if len(blob.encode("utf-8")) <= MAX_BYTES:
        redis(url, token, ["SET", key, blob, "EX", str(TTL_SECONDS)])
        redis(url, token, ["SET", f"{key}:parts", "0", "EX", str(TTL_SECONDS)])
        return 1

    n = (len(blob.encode("utf-8")) // MAX_BYTES) + 1
    size = (len(rows) // n) + 1
    chunks = [rows[i:i + size] for i in range(0, len(rows), size)]
    for i, chunk in enumerate(chunks):
        redis(url, token, ["SET", f"{key}:{i}",
                           json.dumps(chunk, ensure_ascii=False),
                           "EX", str(TTL_SECONDS)])
    redis(url, token, ["SET", f"{key}:parts", str(len(chunks)),
                       "EX", str(TTL_SECONDS)])
    return len(chunks)


def deal_key(row):
    """What makes two rows the same deal.

    deals.deal_id already carries day, exchange, kind, scrip, client and side,
    which is exactly what the exchange means by one deal. It is used here so
    that a later pass replaces an earlier pass's version of the same deal
    rather than adding a second copy - a BSE day re-read at six o'clock has
    the same deals as at two, with more of them.
    """
    return row.get("id") or "|".join(str(row.get(k, "")) for k in
                                     ("day", "exchange", "kind", "symbol",
                                      "who", "side"))


def merge(old, new):
    """The day's deals so far, plus whatever this pass found.

    Per EXCHANGE, replace rather than merge row by row.

    Merging row by row can only ever add. A row written under a rule we have
    since fixed sits there for its whole seven days, so fixing the rule fixes
    nothing a reader can see - which is exactly what happened with the block
    deals printed twice in the bulk report: they were already stored, and the
    de-duplication would have had no effect on the days already written.

    Replacing wholesale would be wrong too. BSE only ever answers with the
    latest day, so for any older day this pass has no BSE rows at all, and
    wiping them would throw away history we cannot fetch again.

    So the unit is the exchange. If this pass has rows from NSE for a day,
    its NSE rows are the whole truth about NSE that day and the stored ones
    go. Exchanges the pass heard nothing from are left alone.
    """
    fresh = {(r.get("exchange") or "") for r in new}
    kept = [r for r in old if (r.get("exchange") or "") not in fresh]
    replaced = len(old) - len(kept)

    was = {deal_key(r) for r in old}
    by_key = {deal_key(r): r for r in kept}
    for r in new:
        by_key[deal_key(r)] = r

    rows = list(by_key.values())
    rows.sort(key=lambda r: -(r.get("value") or 0))
    # "Added" means new to this day, counted against what was there before -
    # not against the rows this pass happened to replace.
    added = len([k for k in by_key if k not in was])
    gone = replaced - (len(by_key) - len(kept))
    return rows, added, max(0, gone)


def store_days(url, token, by_day, log=print):
    """Merge each day's deals into whatever is already stored for it."""
    written = 0
    for day, found in sorted(by_day.items()):
        key = f"mt:deals:{day}"
        rows, added, gone = merge(read_day(url, token, key), found)
        write_day(url, token, key, rows)
        written += added
        dropped = f", -{gone} no longer reported" if gone else ""
        log(f"  deals: {day} now holds {len(rows)} deals "
            f"(+{added}{dropped})")
    return written


def refresh_index(url, token, days_seen):
    raw = redis(url, token, ["GET", "mt:deals:index"])
    try:
        days = json.loads(raw) if raw else []
    except Exception:
        days = []
    days = sorted(set(list(days_seen) + [x for x in days if isinstance(x, str)]),
                  reverse=True)[:KEEP_DAYS]
    redis(url, token, ["SET", "mt:deals:index", json.dumps(days),
                       "EX", str(TTL_SECONDS)])
    return days


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--days", type=int, default=DEFAULT_DAYS,
                   help=f"how far back to read (default {DEFAULT_DAYS})")
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    ist = (datetime.datetime.now(datetime.timezone.utc)
           + datetime.timedelta(hours=5, minutes=30))
    today = ist.date()
    start = today - datetime.timedelta(days=max(1, args.days) - 1)

    found = deals.fetch(start, today)

    if args.dry_run:
        print(f"\n{len(found)} deals from {start} to {today} (nothing written)")
        for r in found[:30]:
            print(f"  {r['day']}  {r['exchange']} {r['kind']:<5} "
                  f"Rs {r['value'] / deals.CRORE:>8,.1f} cr  "
                  f"{r['headline'][:84]}")
        return 0

    url, token = creds()
    if not (url and token):
        print("No KV credentials, so nothing was stored.")
        return 0

    # A pass that found nothing must not erase what an earlier pass found.
    # NSE goes quiet outside market hours and BSE answers with one day only.
    if not found:
        print("  deals: nothing found this pass, leaving what is stored")
        return 0

    by_day = {}
    for r in found:
        by_day.setdefault(r["day"], []).append(r)

    added = store_days(url, token, by_day)
    days = refresh_index(url, token, by_day.keys())

    redis(url, token, ["SET", "mt:deals:meta", json.dumps({
        "at": ist.strftime("%Y-%m-%d %H:%M IST"),
        "found": len(found), "added": added, "days": len(days),
    }), "EX", str(TTL_SECONDS)])

    print(f"  deals: {len(found)} found, {added} new, across "
          f"{len(by_day)} days")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
