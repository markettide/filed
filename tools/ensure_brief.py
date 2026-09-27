"""
Make sure today's morning brief exists, and start it if it does not.

The brief is promised for 07:30 IST. GitHub's own `schedule` does not keep
that promise - it ran the 02:00 UTC slot at 07:03 on 1 September, 06:41 on the
2nd, 06:48 on the 4th, and on the 5th had not fired at all by 11:30 IST. A
newsletter promised for half past seven in the morning arriving at lunchtime,
or not at all.

That was supposed to be fixed on 4 September by a check inside the website's
/api/cron/scrape route. It was not, and the reason is worth writing down: that
route needs CRON_SECRET and GITHUB_DISPATCH_TOKEN, and neither is set on the
Vercel project. The endpoint answers 503 to every caller and always has. The
fix was written, shipped, described as working, and never ran once.

So the check lives here instead, and the scrape workflow calls it. That
workflow really does run every half hour - it dispatches its own successor
with the DISPATCH_TOKEN secret, and the evidence is in the Actions tab. Using
the machinery that demonstrably works, rather than the machinery that was
supposed to.

Needs MONGODB_URI and DISPATCH_TOKEN, both of which the scrape workflow has.
"""

import datetime
import json
import os
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from mongo_mirror import execute

# GITHUB_REPOSITORY is always set inside Actions, so the fallback only
# matters when this is run by hand. The repo moved from It2799/filed to
# markettide/filed on 12 September; GitHub redirects the old name, but a
# redirect is not something to depend on.
OWNER_REPO = os.environ.get("GITHUB_REPOSITORY", "markettide/filed")

# 07:30 IST is the promise. The threshold is 07:25 because the workflow's own
# clock drifts by a few minutes either way, and being five minutes early
# changes nothing: newsletter.py sets its own 07:00 cutoff for what goes in.
DUE_MINUTES_IST = 7 * 60 + 25


def ist_now():
    return datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(
        hours=5, minutes=30)


def newest_issue():
    try:
        raw = execute(["GET", "mt:brief:index"], "brief-watchdog")
    except Exception as e:
        print(f"  could not reach MongoDB: {type(e).__name__}: {e}")
        return None
    if not raw:
        return None
    try:
        days = json.loads(raw)
        return days[0] if isinstance(days, list) and days else None
    except Exception:
        return None


def already_building():
    """Is a brief run in flight? brief.yml queues rather than cancels, so a
    slow build must not be started again on the next pass."""
    token = os.environ.get("DISPATCH_TOKEN")
    url = (f"https://api.github.com/repos/{OWNER_REPO}/actions/workflows/"
           f"brief.yml/runs?status=in_progress&per_page=1")
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    })
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return (json.load(r).get("total_count") or 0) > 0
    except Exception:
        return False          # cannot tell; the queue check below is a nicety


def dispatch():
    token = os.environ.get("DISPATCH_TOKEN")
    url = (f"https://api.github.com/repos/{OWNER_REPO}/actions/workflows/"
           f"brief.yml/dispatches")
    req = urllib.request.Request(
        url, data=json.dumps({"ref": "main"}).encode(),
        headers={"Authorization": f"Bearer {token}",
                 "Accept": "application/vnd.github+json",
                 "X-GitHub-Api-Version": "2022-11-28",
                 "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status == 204
    except urllib.error.HTTPError as e:
        print(f"  GitHub refused the dispatch: {e.code} {e.read()[:200]}")
        return False
    except Exception as e:
        print(f"  could not dispatch: {type(e).__name__}: {e}")
        return False


def main():
    now = ist_now()
    today = now.strftime("%Y-%m-%d")
    minutes = now.hour * 60 + now.minute

    if minutes < DUE_MINUTES_IST:
        print(f"Brief: not due yet ({now:%H:%M} IST).")
        return 0

    if not os.environ.get("DISPATCH_TOKEN"):
        print("Brief: no DISPATCH_TOKEN, so it cannot be started from here.")
        return 0

    newest = newest_issue()
    if newest is None:
        print("Brief: could not read the index, leaving it alone.")
        return 0
    if newest == today:
        print(f"Brief: today's issue ({today}) is already published.")
        return 0

    if already_building():
        print("Brief: a build is already in flight.")
        return 0

    print(f"Brief: newest issue is {newest}, today is {today} "
          f"({now:%H:%M} IST). Starting it.")
    print("  started" if dispatch() else "  could not start it")
    return 0


if __name__ == "__main__":
    sys.exit(main())
