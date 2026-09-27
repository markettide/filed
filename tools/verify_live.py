"""
Check the live site is actually sane. Runs after every scrape.

Every bug that reached the dashboard so far would have been caught by one of
these. They are deliberately blunt assertions about things a user would notice
within seconds - how many days are showing, whether a category you can click
actually returns anything, whether the numbers on the page add up.

    python tools/verify_live.py [--url https://...]

Exits non-zero if anything is wrong, so a scheduled run fails loudly instead of
quietly publishing a broken dashboard.
"""

import argparse
import hashlib
import hmac
import json
import os
import sys
import urllib.parse
import urllib.request

# The site readers actually use, not the preview alias.
#
# This pointed at filed-omega.vercel.app, which Vercel has paused - it answers
# 503 to everything. So every run went red on "Verify the live site" while
# www.markettide.in was serving perfectly well, and a red tick that means
# nothing is worse than no tick: it trains you to ignore the one that matters.
#
# www, not the bare domain, because markettide.in 308-redirects to it and the
# checks below read status codes.
DEFAULT_URL = "https://www.markettide.in"
EXPECT_DAYS = 7

fails, warns = [], []


# The dashboard API is Premium-only, and this check is nobody.
#
# Since the paywall landed on 19 September every completed run has gone red
# here - not because the dashboard was broken, but because an unauthenticated
# reader gets 401 and the verifier treated that as the site being down. A red
# tick that means nothing is worse than no tick: it trains you to ignore the
# one that matters, which is the same lesson this file already learned when it
# was pointed at a paused preview alias.
#
# The way through already exists and is not new machinery: newsletter.py signs
# a purpose-specific HMAC into X-Brief-Worker for exactly this reason, and
# web/lib/brief-worker-auth.js lets it past. The secret is one Actions and
# Vercel already share, and the fallback order below must stay identical to
# both of those files - the server picks the first it has, and a different
# choice here produces a token that verifies against nothing.
BRIEF_WORKER_PURPOSE = b"market-tide-brief-worker-v1"


def worker_headers():
    headers = {"User-Agent": "market-tide-verify"}
    secret = (os.environ.get("BRIEF_WORKER_SECRET")
              or os.environ.get("MONGODB_URI"))
    if secret:
        headers["X-Brief-Worker"] = hmac.new(
            secret.encode(), BRIEF_WORKER_PURPOSE, hashlib.sha256
        ).hexdigest()
    return headers


def get(url, timeout=60):
    req = urllib.request.Request(url, headers=worker_headers())
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def check(ok, label, detail=""):
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}{('  ' + detail) if detail else ''}")
    if not ok:
        fails.append(label)
    return ok


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--url", default=DEFAULT_URL)
    args = p.parse_args()
    base = args.url.rstrip("/")

    print(f"Verifying {base}\n")

    # ---- the pages load at all --------------------------------------------
    print("PAGES")
    for path in ("", "/dashboard", "/join", "/terms", "/refund", "/privacy", "/contact"):
        try:
            req = urllib.request.Request(base + path,
                                         headers=worker_headers())
            with urllib.request.urlopen(req, timeout=45) as r:
                code = r.status
        except Exception as e:
            code = getattr(e, "code", 0)
        check(code == 200, f"{path or '/'} responds", f"HTTP {code}")

    # ---- the data ---------------------------------------------------------
    print("\nDATA")
    try:
        d = get(f"{base}/api/announcements?scope=important")
    except Exception as e:
        if getattr(e, "code", 0) in (401, 403):
            print(f"  [FAIL] the API refused this check: {e}")
            print("         The dashboard API is Premium-only. This check "
                  "signs X-Brief-Worker")
            print("         with BRIEF_WORKER_SECRET or MONGODB_URI")
            print("         the server picks first. One of those has to "
                  "reach this step, and")
            print("         it has to be the SAME one the deployment uses.")
        else:
            print(f"  [FAIL] the API did not answer: {e}")
        sys.exit(1)

    days = d.get("days") or []
    check(len(days) >= EXPECT_DAYS, f"{EXPECT_DAYS} days are listed",
          f"got {len(days)}: {days}")

    total = d.get("total") or 0
    check(total > 0, "there are filings to show", f"total={total}")

    summarised = d.get("summarised") or 0
    check(summarised > 0, "filings carry summaries",
          f"{summarised}/{total} summarised")

    # The window must be seven consecutive dates ending today. A weekend day
    # with no filings still belongs in it - dropping it would quietly shorten
    # the window - but a gap in the middle means a day failed to scrape.
    if days:
        import datetime
        got = sorted(days, reverse=True)
        expected = [(datetime.date.fromisoformat(got[0]) - datetime.timedelta(days=i))
                    .isoformat() for i in range(EXPECT_DAYS)]
        check(got[:EXPECT_DAYS] == expected, "the days are consecutive, no gaps",
              f"got {got[:EXPECT_DAYS]}")

        # dayCounts, not the rows on this page.
        #
        # The API serves ten rows a request, so counting the days present in
        # one page says only that today exists - and this reported "1/7 days
        # have filings" every run while all seven were full. A check that
        # measures the page size rather than the data is worse than no check:
        # it goes red for ever and teaches you to ignore it.
        per_day = d.get("dayCounts") or {}
        with_filings = sum(1 for x in days if (per_day.get(x) or 0) > 0)
        check(with_filings >= 4, "most days actually hold filings",
              f"{with_filings}/{len(days)} days have filings")

    # ---- every category you can click must actually return something ------
    print("\nCATEGORIES")
    counts = d.get("tagCounts") or {}
    check(len(counts) > 5, "categories are present", f"{len(counts)} categories")

    broken = []
    for tag, n in sorted(counts.items(), key=lambda x: -x[1])[:12]:
        try:
            r = get(f"{base}/api/announcements?scope=important&tag="
                    + urllib.parse.quote(tag), timeout=45)
            # "total" is what the filter matched; "count" is what fitted on
            # this page, which is ten. Comparing the sidebar's number against
            # the page size made every busy category look broken.
            served = r.get("total", r.get("count", 0))
            if served != n:
                broken.append(f"{tag} says {n} serves {served}")
        except Exception as e:
            broken.append(f"{tag} errored: {e}")
    check(not broken, "sidebar counts match what each category serves",
          "; ".join(broken) if broken else "")

    # ---- freshness --------------------------------------------------------
    print("\nFRESHNESS")
    updated = (d.get("meta") or {}).get("updated")
    check(bool(updated), "the store records when it last ran", str(updated))

    print()
    if fails:
        print(f"{len(fails)} CHECK(S) FAILED: {fails}")
        sys.exit(1)
    print("All checks passed.")


if __name__ == "__main__":
    main()
