"""
Scrape, summarise, and push the result into Redis for the website to serve.

This is what runs on a schedule in the cloud. Nothing here writes HTML - the
website reads the data and renders it, so the dashboard is always as fresh as
the last run.

    python publish.py                 last 7 days
    python publish.py --days 2        just catch up the last couple of days
    python publish.py --dry-run       do the work, print, but don't write

Credentials come from the environment so nothing sensitive lives in the repo:

    KV_REST_API_URL      from Vercel (Storage tab), or UPSTASH_REDIS_REST_URL
    KV_REST_API_TOKEN    from Vercel,               or UPSTASH_REDIS_REST_TOKEN
    GROQ_API_KEY         optional, falls back to config.json
    GEMINI_API_KEY       optional, falls back to config.json

Data layout, one key per day so old days expire on their own:

    mt:day:2026-08-10   ->  JSON list of that day's important filings
    mt:index            ->  JSON list of the days we currently hold
    mt:meta             ->  when it last ran, and what it found
"""

import argparse
import datetime
import json
import os
import sys

import requests

import dedupe
import mcap
import rules
import triage
import pipeline
from mongo_mirror import mirror_safely

HERE = os.path.dirname(os.path.abspath(__file__))
KEEP_DAYS = 7

# The exchanges, the filings and the readers are all Indian, but the scheduler
# runs on UTC. Between midnight and 05:30 IST, UTC is still on yesterday's
# date - which built the window a day behind and left today off the dashboard.
IST = datetime.timezone(datetime.timedelta(hours=5, minutes=30))


def today_ist():
    return datetime.datetime.now(IST).date()
TTL_SECONDS = 60 * 60 * 24 * (KEEP_DAYS + 2)      # a little slack past 7 days


# ---------------------------------------------------------------- config

def redis_creds():
    url = os.environ.get("KV_REST_API_URL") or os.environ.get("UPSTASH_REDIS_REST_URL")
    tok = os.environ.get("KV_REST_API_TOKEN") or os.environ.get("UPSTASH_REDIS_REST_TOKEN")
    return url, tok


def load_providers():
    """Prefer environment keys (that's how the cloud gets them), else config.json."""
    groq = os.environ.get("GROQ_API_KEY", "")
    gem = os.environ.get("GEMINI_API_KEY", "")
    orouter = os.environ.get("OPENROUTER_API_KEY", "")

    cfg = {}
    path = os.path.join(HERE, "config.json")
    if os.path.exists(path):
        try:
            cfg = json.load(open(path, encoding="utf-8"))
        except Exception:
            cfg = {}

    out = []
    for p in cfg.get("providers", []):
        p = dict(p)
        if p.get("kind") == "groq" and groq:
            p["key"] = groq
        if p.get("kind") == "gemini" and gem:
            p["key"] = gem
        if p.get("kind") == "openrouter" and orouter:
            p["key"] = orouter
        if p.get("key") and not p["key"].startswith("PUT_YOUR"):
            out.append(p)

    if not out:                        # no config file at all - build defaults
        # OpenRouter first, because Ishan asked for it and because the models
        # below were checked against our own JSON schema with a real filing on
        # 9 September - which is more than could be said for the list they
        # replaced.
        #
        # Of the four models configured before, only one still worked:
        #   dots-3-note-preview   17.0s   ok
        #   z-ai/glm-5.2          gone from OpenRouter entirely, 404 every call
        #   gemma-4-31b-it        429, rate limited on the shared free pool
        #   gemma-4-26b-a4b-it    429, same
        #
        # A model can vanish or start refusing and nothing here would say so,
        # which is why tools/check_models.py exists now.
        if orouter:
            out.append({"kind": "openrouter", "key": orouter, "tpm": 60000,
                        "vision": False,
                        "models": [
                            # 3.5s, and the fastest of everything tested.
                            "nex-agi/nex-n2.5-mini:free",
                            "dots-studio/dots-3-note-preview:free",
                            "nvidia/nemotron-3.5-lightning:free",
                            # Rate limited when tested rather than gone, so
                            # kept at the back where a recovered quota helps
                            # and a dead one costs one failed call.
                            "google/gemma-4-31b-it:free",
                            "google/gemma-4-26b-a4b-it:free",
                        ]})
        if groq:
            out.append({"kind": "groq", "key": groq, "tpm": 8000, "vision": False,
                        "models": ["openai/gpt-oss-120b", "openai/gpt-oss-20b"]})
        if gem:
            # Gemini's free tier allows 500 requests a day PER MODEL, so the
            # length of this list is the daily ceiling: five models is 2,500
            # summaries, two was 1,000 and ran out halfway through a backfill.
            # gemini-2.0-flash was retired by Google and 404s on every call.
            out.append({"kind": "gemini", "key": gem, "tpm": 250000, "vision": True,
                        "models": ["gemini-3.6-flash", "gemini-3.5-flash",
                                   "gemini-3.1-flash-lite",
                                   "gemini-flash-lite-latest",
                                   "gemini-3-flash-preview"]})
    return out


# ---------------------------------------------------------------- redis

# The "All" tab doesn't need summaries or the long headline, and trimming keeps
# a busy day's payload well under Upstash's request size limit.
SLIM_FIELDS = ("id", "exchange", "company", "ticker", "category", "headline",
               # "board" belongs in the slim list too: the SME dashboard has to
               # be able to show the long tail, and that is what this list is.
               "time", "date", "score", "tag", "pdf_url", "mcap", "board")

MAX_BYTES = 700_000        # stay comfortably inside the REST request limit


def redis(url, token, command):
    r = requests.post(url, headers={"Authorization": f"Bearer {token}",
                                    "Content-Type": "application/json"},
                      json=command, timeout=90)
    if not r.ok:
        raise RuntimeError(f"Redis {r.status_code}: {r.text[:200]}")
    result = r.json().get("result")
    mirror_safely(command, "announcements")
    return result


def write_day(url, token, key, rows):
    """
    Write one day's rows, splitting into parts if they're too big for a single
    request. A heavy results day can carry over a thousand filings.
    """
    if not rows:
        redis(url, token, ["SET", key, "[]", "EX", str(TTL_SECONDS)])
        return 1

    blob = json.dumps(rows, ensure_ascii=False)
    if len(blob.encode("utf-8")) <= MAX_BYTES:
        redis(url, token, ["SET", key, blob, "EX", str(TTL_SECONDS)])
        redis(url, token, ["SET", key + ":parts", "1", "EX", str(TTL_SECONDS)])
        return 1

    parts = (len(blob.encode("utf-8")) // MAX_BYTES) + 1
    size = (len(rows) // parts) + 1
    chunks = [rows[i:i + size] for i in range(0, len(rows), size)]
    for i, chunk in enumerate(chunks):
        redis(url, token, ["SET", f"{key}:{i}",
                           json.dumps(chunk, ensure_ascii=False), "EX", str(TTL_SECONDS)])
    redis(url, token, ["SET", key + ":parts", str(len(chunks)), "EX", str(TTL_SECONDS)])
    redis(url, token, ["DEL", key])          # the single-blob form is now stale
    return len(chunks)




def publish_index(url, token, today, run_stats):
    """
    Rebuild the day index and the headline figures from what is genuinely in
    the store. Called after every day so the site keeps pace with the work.
    Returns (days, totals).
    """
    window = [(today - datetime.timedelta(days=i)).isoformat()
              for i in range(KEEP_DAYS)]
    marks = redis(url, token, ["MGET", *[f"mt:count:{d}" for d in window]]) or []

    live_days, totals = [], {"important": 0, "other": 0, "summarised": 0,
                            "scanned": 0, "read": 0,
                            "scanned_sme": 0, "scanned_main": 0}
    for d, mark in zip(window, marks):
        if not mark:
            continue
        live_days.append(d)
        try:
            c = json.loads(mark)
            for k in totals:
                totals[k] += int(c.get(k) or 0)

            # A day recorded before the boards were tagged has "scanned" but
            # neither half of the split, so it contributes nothing to either -
            # and the main board's headline figure collapsed from 19,139 to
            # 2,591, which is today alone, the moment the split was introduced.
            #
            # Everything on those days was shown as main board, because that is
            # all there was, so that is where their count belongs. It corrects
            # itself as each day gets rescraped with the tagging.
            if c.get("scanned") and not c.get("scanned_main")                     and not c.get("scanned_sme"):
                totals["scanned_main"] += int(c.get("scanned") or 0)
        except Exception:
            pass

    meta = {
        # Run tallies first, then the window-wide totals on top - the whole
        # week is what the dashboard claims to describe, so the week wins.
        **run_stats,
        "updated": datetime.datetime.now(datetime.timezone.utc)
                   .strftime("%Y-%m-%dT%H:%M:%SZ"),
        "days": live_days,
        # Days written before per-day tallies existed carry none, and a zero
        # there would blank the headline rather than correct it. So a summed
        # figure only replaces the run's own when it actually adds up to
        # something.
        **{k: v for k, v in totals.items() if v},
    }
    redis(url, token, ["SET", "mt:index", json.dumps(live_days)])
    redis(url, token, ["SET", "mt:meta", json.dumps(meta, ensure_ascii=False)])
    return live_days, totals


# ---------------------------------------------------------------- main

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--days", type=int, default=KEEP_DAYS,
                   help=f"how many days back to scrape (default {KEEP_DAYS})")
    p.add_argument("--min-score", type=int, default=0,
                   help="lowest score worth storing. 0 keeps everything, which "
                        "is what triage needs - a filing scoring 18 on its "
                        "headline can turn out to be a chief executive resigning.")
    p.add_argument("--important-at", type=int, default=55,
                   help="score at which a filing counts as Important")
    p.add_argument("--max-summaries", type=int, default=0,
                   help="0 means summarise every important filing. Set a number "
                        "only if you want to cap AI calls for a run. Summaries "
                        "are cached, so a rerun only pays for what is new.")
    p.add_argument("--workers", type=int, default=4)
    p.add_argument("--force", action="store_true",
                   help="overwrite a day even if the stored one is fuller")
    # Reading PDFs is waiting on a download, not on a model, so it can run
    # far wider than summarising - which has a rate limit to respect.
    p.add_argument("--read-workers", type=int, default=0,
                   help="threads for downloading PDFs (default: 3x --workers)")
    p.add_argument("--no-mcap", action="store_true",
                   help="skip the market-cap lookup")
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    url, token = redis_creds()
    if not args.dry_run and not (url and token):
        sys.exit("No Redis credentials. Set KV_REST_API_URL and KV_REST_API_TOKEN.")

    provider_list = load_providers()
    print(f"Reading PDFs on {args.read_workers or max(1, args.workers) * 3} threads, summarising on {args.workers}")
    print(f"AI providers configured: {[p['kind'] for p in provider_list] or 'none'}\n")

    today = today_ist()
    first = today - datetime.timedelta(days=max(0, args.days))
    cutoff = (today - datetime.timedelta(days=KEEP_DAYS - 1)).isoformat()

    # Work newest day first and publish each one the moment it is finished,
    # rather than doing everything and writing at the end. A full read of a
    # week takes the better part of an hour; publishing only at the end meant
    # nothing appeared for that whole time, and a cancelled run threw away
    # every bit of it. Today's filings now land within a couple of minutes.
    day_list = [today - datetime.timedelta(days=k)
                for k in range((today - first).days + 1)]

    read_workers = args.read_workers or max(1, args.workers) * 3

    run = {"scanned": 0, "stored": 0, "read": 0, "promoted": 0, "summarised": 0}

    for n, day in enumerate(day_list, 1):
        iso = day.isoformat()
        if iso < cutoff:
            continue
        print("=" * 62)
        print(f"DAY {n}/{len(day_list)}   {iso}")
        print("=" * 62)

        raw, kept = pipeline.fetch_and_score(day, day, args.min_score)
        kept = dedupe.collapse(kept)
        triage.triage(kept, important_at=args.important_at, workers=read_workers)
        tri = getattr(triage, "last_stats", {"read": 0, "promoted": 0})

        # Reading the PDFs re-labels filings, which can reveal that two entries
        # sitting under different tags were the same event all along. So the
        # duplicate check runs again now that the tags are trustworthy.
        kept = dedupe.collapse(kept)

        worth = [a for a in kept if a.get("score", 0) >= args.important_at]

        # Press releases get read even when they score below the line.
        #
        # A company files one under the category "Press Release" with the
        # headline "Please refer attached file". That scores 44, and 44 is
        # below the 55 needed to be summarised - so nothing ever asked what
        # the release said, and the one thing a company issues BECAUSE it
        # wants the news noticed was the one thing never read. 31 of the 33
        # press releases filed on 4 September scored under the line, Balaji
        # Telefilms' among them.
        #
        # The regex cannot help here: the headline says nothing and the topic
        # patterns have nothing to match. Only the summary can, and once it
        # names a real event the relabel in pipeline.summarise promotes the
        # filing to what that event is worth.
        # ...and so does anything the headline AND the regex both failed on.
        #
        # A tag of Other, Outcome, Board Meeting, Corp Action or Unusual is not
        # an answer. It means the headline said nothing and the topic patterns
        # found nothing in the PDF either - which is precisely when a person
        # would open the document and read it. So that is what happens now.
        #
        # About fifteen a day, on top of the press releases. "Outcome of Board
        # Meeting held today 04.09.2026" is the shape of it: the board decided
        # something and only the attachment says what.
        also_read = [a for a in kept
                     if a.get("score", 0) < args.important_at
                     and (rules.is_press_release(a.get("category", ""))
                          or rules.undecided(a.get("tag")))]
        todo = worth + also_read

        cap = args.max_summaries or len(todo)
        print(f"{len(kept)} stored, {len(worth)} relevant "
              f"(+{len(also_read)} press releases below the line). "
              + ("Summarising all." if not args.max_summaries
                 else f"Summarising up to {cap}."))
        pipeline.summarise(todo, provider_list, cap, workers=args.workers)

        if not args.no_mcap:
            mcap.attach(kept, workers=read_workers)

        rows = pipeline.to_rows(kept)

        # Worth reading means summarised - the two are the same set, so the
        # dashboard can never show one number for what matters and a smaller
        # one for what was explained. A filing we genuinely could not read
        # (a scan no model could see through) is not shown as a headline item
        # with a blank where its summary belongs; it drops to the full list.
        def is_headline(r):
            return r.get("score", 0) >= args.important_at and r.get("summary")

        important = [r for r in rows if is_headline(r)]
        rest = [{k: r.get(k, "") for k in SLIM_FIELDS}
                for r in rows if not is_headline(r)]
        done = len(important)

        run["scanned"] += len(raw)
        run["stored"] += len(kept)
        run["read"] += tri.get("read", 0)
        run["promoted"] += tri.get("promoted", 0)
        run["summarised"] += done

        print(f"  -> {len(important)} important ({done} summarised), {len(rest)} other")

        if args.dry_run:
            continue

        # A day that is already richer than what this run produced is left
        # alone. Summaries depend on a daily AI quota, and a run that starts
        # after that quota is spent will summarise almost nothing - without
        # this guard the nightly full pass would overwrite a complete day with
        # a threadbare one, and a week of reading would be gone. Growth is
        # always allowed; only a large drop is refused.
        held = redis(url, token, ["GET", f"mt:count:{iso}"])
        if held and not args.force:
            try:
                mark = json.loads(held)
                was = int(mark.get("important") or 0)
                was_rules = mark.get("rules") or ""
                was_scanned = int(mark.get("scanned") or 0)
            except Exception:
                was, was_rules, was_scanned = 0, "", 0

            # The guard exists so a starved run - NSE down, quota gone - cannot
            # replace a full day with half of one. But a rules change also
            # lowers the count, on purpose: fixing a rule that wrongly promoted
            # filings means fewer of them, and that is the whole point.
            #
            # Told apart by the rules fingerprint stored with the day. Same
            # rules and far fewer filings means something went wrong. Different
            # rules means the drop was intended, and refusing it would freeze
            # every correction out of the site - which is exactly what happened
            # to 30 August, where an AGM notice sat under Acquisition through
            # four passes because each one produced 7 filings where the old
            # rules had produced 14.
            # A missing fingerprint counts as changed. Days written before the
            # mark existed cannot vouch for which rules produced them, and
            # treating "unknown" as "same" would have frozen every one of them
            # for ever - a day can only get its fingerprint by being rewritten,
            # and it can only be rewritten if the guard lets it through.
            rules_changed = was_rules != triage.rules_fingerprint()

            # How much was FETCHED is checked first, and the rules have no say
            # in it. Everything below this is about scoring - how many filings
            # cleared the bar - and a rules change is a legitimate reason for
            # that to fall. The number of documents the exchanges handed over
            # is not about scoring at all, so a large drop there is never
            # legitimate. It means the fetch was short.
            #
            # That distinction is the hole this closes. On 3 September a BSE
            # page timed out and ended the day's paging early - 349 documents
            # where the day had 729 - and because the rules had just changed,
            # the guard below waved the truncated day straight through and
            # published it over a complete one. Both halves looked reasonable
            # on their own.
            if was_scanned and len(raw) < was_scanned * 0.75 and not args.force:
                print(f"  -> KEPT the stored day: this run fetched "
                      f"{len(raw)} filings where the last one fetched "
                      f"{was_scanned}. That is a short fetch, not a quiet day. "
                      f"Re-run with --force to overwrite anyway.")
                continue

            if was and len(important) < was * 0.7 and not rules_changed:
                print(f"  -> KEPT the stored day: it has {was} summarised, "
                      f"this run only managed {len(important)}. "
                      f"Re-run with --force to overwrite anyway.")
                continue
            if rules_changed and len(important) < was * 0.7:
                print(f"  -> the rules changed since this day was written "
                      f"({was} -> {len(important)}); publishing the new verdict")

        write_day(url, token, f"mt:day:{iso}", important)
        write_day(url, token, f"mt:all:{iso}", rest)
        redis(url, token, ["SET", f"mt:count:{iso}", json.dumps({
            "important": len(important), "other": len(rest), "summarised": done,
            # Per-day, so the headline figures describe the whole week rather
            # than whichever days the last run happened to touch. A 45-minute
            # top-up scrapes one day; without this it would report that day's
            # filing count as the week's.
            "scanned": len(raw), "read": tri.get("read", 0),
            # Split by board as well, because the SME dashboard has its own
            # funnel and "19,139 filed on NSE & BSE" above 42 SME filings is
            # not a funnel, it is two unrelated numbers stacked.
            "scanned_sme": sum(1 for a in raw if a.get("board") == "SME"),
            "scanned_main": sum(1 for a in raw if a.get("board") != "SME"),
            # Which rules produced these numbers, so the guard above can tell a
            # deliberate drop from a starved one.
            "rules": triage.rules_fingerprint(),
        }), "EX", str(TTL_SECONDS)])

        publish_index(url, token, today, run)
        print(f"  -> published. The dashboard is showing {iso} now.")

    if args.dry_run:
        print("(dry run - nothing written)")
        return

    live_days, totals = publish_index(url, token, today, run)

    span = f"{live_days[-1]} to {live_days[0]}" if live_days else "nothing"
    print("")
    print(f"Index now lists {len(live_days)} days ({span})")
    print(f"Holding {totals['important']} important + {totals['other']} other, "
          f"{totals['summarised']} summarised.")
    print(f"This run read {run['read']} PDFs and rescued {run['promoted']} "
          f"that the headline had buried.")


if __name__ == "__main__":
    main()
