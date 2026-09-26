"""The morning brief: one PDF, the fifty filings worth knowing about.

Reads the same data the website serves and covers everything filed from the
start of yesterday up to 07:00 this morning, so an announcement made overnight
reaches the reader at breakfast rather than a day later. The issue goes out at
07:30 IST.

Left out: concalls, investor presentations and investor meets (a diary entry is
not news), and dividends and splits (routine, and frequent enough to crowd out
everything else). What remains is picked across categories so one busy results
day cannot fill the whole issue.

    python newsletter.py                    # today's issue
    python newsletter.py --day 2026-09-01   # rebuild a particular issue
    python newsletter.py --count 30
    python newsletter.py --html-only        # skip the PDF step
    python newsletter.py --publish          # put it on the site

The PDF is printed by headless Chrome, which every runner already has and
which is the only renderer that makes CSS look the way a browser does.
"""

import argparse
import datetime
import hashlib
import hmac
import html
import json
import os
import shutil
import subprocess
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "brief")
# www, not the bare domain. markettide.in answers every request with a 308 to
# www.markettide.in, and a redirect on every one of a hundred-odd paged
# requests is a hundred wasted round trips - and urllib gave up partway through
# with a connection reset rather than following them all.
API = "https://www.markettide.in/api/announcements?scope=important"
BRIEF_WORKER_PURPOSE = b"market-tide-brief-worker-v1"

# The API hands back ten rows a request, so the whole window takes many. Capped
# so a paging bug on either side cannot spin for ever; 120 pages is 1,200
# filings, comfortably more than two days of important news.
MAX_PAGES = 120

# A call, a slide deck and a meeting invitation are things an investor puts in
# a diary, not things that happened. Dividends and splits are left out too -
# they are routine enough, and frequent enough, to crowd out the news.
SKIP_TAGS = {"Concall", "Investor Presentation", "Investor Meet",
             "Dividend", "Split"}

# The issue goes out at 7:30am IST and covers everything filed since the start
# of yesterday up to 07:00 that morning - so an announcement made overnight is
# in the reader's hands at breakfast rather than a day later. Half an hour is
# enough to build and send it.
CUTOFF_HOUR, CUTOFF_MIN = 7, 0

# The order sections appear in. Anything not named here follows, alphabetically.
SECTION_ORDER = [
    "Results", "Acquisition", "Scheme Of Arrangement", "Order", "Buyback",
    "Bonus", "Rights Issue", "Open Offer", "Delisting",
    "Qip", "Qip Allotment", "Pref", "Warrants", "Fund Raising",
    "Capacity Increase", "Business Update", "Operations", "Ratings Update",
    "Nclt", "Legal/Reg", "Change In Management",
]

# The same details as web/app/site.js. Kept here rather than imported because
# that file is JavaScript; if one changes, change the other.
CONTACT = {
    "site": "markettide.in",
    "email": "market.tide27@gmail.com",
    "phone": "+91 82004 40146",
    "community": "https://markettide.in/brief",
}

# Drawn inline rather than linked, because a PDF has no way to fetch an image
# once it has left the machine that made it.
WA_LOGO = (
    '<svg class="wa-mark" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">'
    '<path fill="#25D366" d="M16 0a16 16 0 0 0-13.6 24.4L0 32l7.8-2.3A16 16 0 1 0 16 0Z"/>'
    '<path fill="#fff" d="M11.9 8.6c-.3-.7-.6-.7-.9-.7h-.7c-.3 0-.7.1-1 .5-.4.4-1.3 1.3-1.3 3.1s1.3 3.6 1.5 3.9c.2.2 2.6 4.1 6.4 5.6 3.1 1.2 3.8 1 4.5.9.7-.1 2.2-.9 2.5-1.8.3-.9.3-1.6.2-1.8-.1-.2-.4-.3-.8-.5-.4-.2-2.2-1.1-2.6-1.2-.4-.1-.6-.2-.8.2-.2.4-.9 1.2-1.1 1.4-.2.2-.4.3-.8.1-.4-.2-1.6-.6-3-1.9-1.1-1-1.9-2.2-2.1-2.6-.2-.4 0-.6.2-.8l.6-.7c.2-.2.2-.4.3-.6.1-.2 0-.5 0-.7l-1.1-2.4Z"/>'
    "</svg>"
)

CHROME_CANDIDATES = [
    os.environ.get("CHROME_PATH"),
    "/c/Program Files/Google/Chrome/Application/chrome.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "google-chrome", "google-chrome-stable", "chromium", "chromium-browser",
]


# --------------------------------------------------------------------- data

def fetch(day=None, source=None, max_pages=MAX_PAGES, earliest=None):
    """Every important filing the site holds, a page at a time.

    The API returns ten rows per request and no more - MAX_PAGE_SIZE in
    web/app/api/announcements/route.js, which exists so the dashboard can page
    through them. This asked for one page and got ten filings, so the brief
    was chosen from ten candidates however large --count was: the issue of
    11 September said "8 filings from 10" and nobody noticed, because eight
    filings still look like a newsletter.

    Nothing failed. The cap was added for the dashboard and silently became
    the size of the morning brief.

    board=Main, because the brief is a main-board product. SME filings have
    been arriving since NSE's sme list started being fetched, and an SME
    company is a different thing from the ones this issue is about.

    `earliest` is the oldest day the caller wants. Rows come back newest
    first, so once a whole page falls before it there is nothing left to find
    and the remaining pages can be left alone.
    """
    if source:
        with open(source, encoding="utf-8") as f:
            data = json.load(f)
        rows = data.get("items") or []
        meta = data.get("meta") or {}
        if day:
            rows = [r for r in rows if r.get("day") == day]
        return rows, meta

    rows, meta, page = [], {}, 1
    while page <= max_pages:
        url = f"{API}&board=Main&page={page}"
        headers = {"User-Agent": "markettide-brief"}
        # Premium protects the browser API, but the PDF worker still needs a
        # secure server-to-server read. Derive a purpose-specific signature
        # from a secret already shared by Actions and Vercel. Never send the
        # secret itself.
        worker_secret = (os.environ.get("BRIEF_WORKER_SECRET")
                         or os.environ.get("MONGODB_URI")
                         or os.environ.get("KV_REST_API_TOKEN")
                         or os.environ.get("UPSTASH_REDIS_REST_TOKEN"))
        if worker_secret:
            headers["X-Brief-Worker"] = hmac.new(
                worker_secret.encode(), BRIEF_WORKER_PURPOSE, hashlib.sha256
            ).hexdigest()
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.load(r)

        got = data.get("items") or []
        rows.extend(got)
        meta = meta or data.get("meta") or {}

        if not got:
            break

        # page, pageSize, totalPages and hasMore are TOP-LEVEL on this
        # response, not under a "paging" object. Reading a key that is not
        # there gives None, which reads as "no idea how many pages", and the
        # loop would then walk all 159 of them every morning.
        if not data.get("hasMore"):
            break
        total_pages = data.get("totalPages")
        if total_pages and page >= int(total_pages):
            break

        # Rows come back newest first, so once a whole page is older than the
        # window there is nothing left to find. The brief covers yesterday and
        # this morning; the site holds a week.
        if earliest and all((r.get("day") or "") < earliest for r in got):
            break

        page += 1

    if day:
        rows = [r for r in rows if r.get("day") == day]
    return rows, meta


def pick(rows, count):
    """The `count` biggest filings, with no category allowed to swallow the issue.

    Strict importance order would hand a heavy results day all fifty slots to
    results. Strict round-robin does the opposite and gives a lone bonus issue
    the same billing as the quarter's numbers. So: work down by importance,
    but stop taking from a category once it has had its share, and only relax
    that if there is not enough news to fill the brief without it.
    """
    rows = [r for r in rows
            if r.get("tag") not in SKIP_TAGS and (r.get("summary") or "").strip()]
    rows.sort(key=lambda r: (-(r.get("score") or 0), -(r.get("mcap") or 0)))

    cap = max(3, round(count / 8))
    out, taken = [], {}
    for limit in (cap, cap * 2, count):          # widen only if short
        for r in rows:
            if len(out) >= count:
                break
            if r in out:
                continue
            t = r.get("tag") or "Other"
            if taken.get(t, 0) >= limit:
                continue
            out.append(r)
            taken[t] = taken.get(t, 0) + 1
        if len(out) >= count:
            break
    return out


IST = datetime.timezone(datetime.timedelta(hours=5, minutes=30))


def filed_at(row):
    """The clock time on a filing, as minutes past midnight, or None.

    The feed gives it as a display string - "31 Aug, 23:40" - so the date part
    is already covered by `day` and only the clock is wanted here.
    """
    t = (row.get("time") or "").strip()
    if "," in t:
        t = t.split(",")[-1].strip()
    try:
        h, m = t.split(":")[:2]
        return int(h) * 60 + int(m)
    except Exception:
        return None


def window(rows, issue_date=None):
    """Everything filed from the start of yesterday to 07:00 this morning.

    A newsletter that stopped at midnight would hold anything filed overnight
    for a further twenty-four hours. Running to 07:00, half an hour before the
    issue goes out, means the reader gets it the same morning.

    Returns (rows in the window, the issue's date). The issue is dated the day
    it is published, not the day it reports on, because it spans both.
    """
    today = issue_date or datetime.datetime.now(IST).date()
    if isinstance(today, str):
        today = datetime.date.fromisoformat(today)
    yesterday = today - datetime.timedelta(days=1)
    cutoff = CUTOFF_HOUR * 60 + CUTOFF_MIN

    keep = []
    for r in rows:
        day = r.get("day")
        if day == yesterday.isoformat():
            keep.append(r)
        elif day == today.isoformat():
            mins = filed_at(r)
            if mins is None or mins <= cutoff:
                keep.append(r)
    return keep, today.isoformat()


def group(picked):
    secs = {}
    for r in picked:
        secs.setdefault(r.get("tag") or "Other", []).append(r)
    for v in secs.values():
        v.sort(key=lambda r: (-(r.get("mcap") or 0), -(r.get("score") or 0)))
    order = [t for t in SECTION_ORDER if t in secs]
    order += sorted(t for t in secs if t not in SECTION_ORDER)
    return [(t, secs[t]) for t in order]


# --------------------------------------------------------------- formatting

def crore(v):
    if not v:
        return ""
    v = float(v)
    if v >= 100000:
        return f"\u20b9{v/100000:.2f} L Cr"
    return f"\u20b9{v:,.0f} Cr".replace(",", ",")


def indian(n):
    s = f"{int(n):,}"                      # 1,234,567
    if len(s.replace(",", "")) <= 3:
        return s
    d = s.replace(",", "")
    head, tail = d[:-3], d[-3:]
    parts = []
    while len(head) > 2:
        parts.insert(0, head[-2:])
        head = head[:-2]
    if head:
        parts.insert(0, head)
    return ",".join(parts + [tail])


def e(s):
    return html.escape(str(s or ""))


def pretty_day(iso):
    d = datetime.date.fromisoformat(iso)
    return d.strftime("%d %B %Y").lstrip("0")


# ------------------------------------------------------------------ styling

CSS = """
@page { size: A4; margin: 16mm 14mm 18mm; }
/* The cover bleeds to the paper edge, so page one has no margin at all.
   Zeroing only margin-top left 18mm at the foot, which made a 297mm cover
   18mm too tall for its own page and spilled a sliver onto page two. */
@page :first { margin: 0; }

* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body {
  margin: 0;
  font-family: "Inter", -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 9.6pt; line-height: 1.5; color: #14161a;
  font-variant-numeric: tabular-nums;
}
h1, h2, h3 { margin: 0; font-weight: 600; }
.serif { font-family: "Instrument Serif", Georgia, "Times New Roman", serif;
         font-weight: 400; letter-spacing: -0.01em; }

/* ---------- cover ---------- */
.cover {
  height: 297mm; padding: 26mm 18mm 20mm;
  background: linear-gradient(150deg, #4f9cff 0%, #6a7dff 46%, #7c5cff 100%);
  color: #fff; page-break-after: always; position: relative;
}
.cover .mark { display: flex; align-items: center; gap: 9px;
               font-size: 12pt; font-weight: 600; letter-spacing: -0.01em; }
.cover .mark i { width: 9px; height: 9px; border-radius: 50%;
                 background: #fff; display: inline-block; }
.cover h1 { font-size: 46pt; line-height: 1.02; margin: 34mm 0 0; max-width: 15ch; }
.cover .rule { width: 46mm; height: 2px; background: rgba(255,255,255,.55);
               margin: 9mm 0 7mm; }
.cover .date { font-size: 13pt; font-weight: 500; letter-spacing: .01em; }
.cover .blurb { margin: 4mm 0 0; font-size: 10.8pt; line-height: 1.62;
                max-width: 58ch; color: rgba(255,255,255,.93); }
.cover .blurb b { font-weight: 600; color: #fff; }
.cover .figs { position: absolute; left: 18mm; right: 18mm; bottom: 20mm;
               display: flex; gap: 0; border-top: 1px solid rgba(255,255,255,.35);
               padding-top: 6mm; }
.cover .fig { flex: 1; }
.cover .fig b { display: block; font-size: 21pt; font-weight: 600;
                letter-spacing: -0.02em; line-height: 1; }
.cover .fig span { font-size: 8.6pt; color: rgba(255,255,255,.85);
                   display: block; margin-top: 2mm; }

/* ---------- running header ---------- */
.masthead {
  display: flex; justify-content: space-between; align-items: baseline;
  border-bottom: 1.4px solid #14161a; padding-bottom: 2.5mm; margin-bottom: 6mm;
}
.masthead .n { font-size: 11pt; font-weight: 600; letter-spacing: -0.01em; }
.masthead .d { font-size: 8.6pt; color: #6b7280; }

/* ---------- contents ---------- */
.toc { margin-bottom: 8mm; page-break-after: always; }
.toc h2 { font-size: 20pt; margin-bottom: 5mm; }
.toc ol { margin: 0; padding: 0; list-style: none; columns: 2; column-gap: 12mm; }
.toc li { display: flex; justify-content: space-between; gap: 4mm;
          padding: 2.1mm 0; border-bottom: 1px solid #eceef1;
          break-inside: avoid; font-size: 9.4pt; }
.toc li span { color: #6b7280; font-size: 8.8pt; }

/* ---------- sections ---------- */
.sec { margin-bottom: 7mm; break-inside: auto; }
.sec-h { display: flex; align-items: baseline; gap: 4mm; margin-bottom: 3.5mm;
         break-after: avoid; }
.sec-h h2 { font-size: 15pt; letter-spacing: -0.01em; }
.sec-h .n { font-size: 8.4pt; color: #8a9099; font-weight: 500; }
.sec-h .line { flex: 1; height: 1px; background: #e4e7eb; }

/* ---------- one filing ---------- */
.item { break-inside: avoid; padding: 3.4mm 0 3.6mm;
        border-bottom: 1px solid #eceef1; }
.item:last-child { border-bottom: 0; }
.item .top { display: flex; align-items: baseline; gap: 3mm; margin-bottom: 1.6mm; }
.item .co { font-size: 10.6pt; font-weight: 600; letter-spacing: -0.012em;
            line-height: 1.25; }
.item .mcap { font-size: 8pt; font-weight: 600; color: #4b5563;
              background: #f1f3f6; border-radius: 3px; padding: 0.6mm 1.6mm;
              white-space: nowrap; }
.item .ex { margin-left: auto; font-size: 7.8pt; color: #9aa1ab;
            white-space: nowrap; letter-spacing: .02em; }
.item p { margin: 0; font-size: 9.5pt; line-height: 1.58; color: #23262c; }
.item .nums { margin-top: 2.2mm; display: flex; flex-wrap: wrap; gap: 1.6mm; }
.item .nums span { font-size: 8.1pt; color: #3d4350; background: #f6f7f9;
                   border: 1px solid #e9ebef; border-radius: 3px;
                   padding: 0.7mm 2mm; }
.item .why { margin-top: 2.2mm; font-size: 8.9pt; color: #5b6270;
             border-left: 2px solid #cfd4dc; padding-left: 3mm; line-height: 1.5; }

/* ---------- closing ---------- */
.end { margin-top: 9mm; padding-top: 5mm; border-top: 1.4px solid #14161a;
       font-size: 8.6pt; color: #6b7280; line-height: 1.65;
       break-inside: avoid; }
.end b { color: #14161a; }
.end-top { display: flex; gap: 12mm; align-items: flex-start; }
.end-top > div:first-child { flex: 1; }
.end-contact { display: flex; flex-direction: column; gap: 0.8mm;
               min-width: 52mm; }
.end-contact .end-h { font-size: 7.6pt; font-weight: 700; color: #14161a;
                      letter-spacing: 0.06em; text-transform: uppercase;
                      margin-bottom: 1mm; }
.end-contact a { color: #3d4350; text-decoration: none; }
.end-contact .wa { margin-top: 1.4mm; }
.end-contact .wa a { display: inline-flex; align-items: center; gap: 1.6mm;
                     color: #128C4A; font-weight: 600; }
.wa-mark { width: 3.6mm; height: 3.6mm; flex: none; }
.end-note { margin-top: 5mm; padding-top: 3mm; border-top: 1px solid #e4e7eb;
            font-size: 8pt; color: #8a9099; }
"""


# ------------------------------------------------------------------- render

FONTS = ("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&"
         "family=Instrument+Serif&display=swap")


def render(rows, day_iso, meta, count):
    picked = pick(rows, count)
    sections = group(picked)
    day_txt = pretty_day(day_iso)
    companies = len({r.get("company") for r in picked})

    out = [
        "<!doctype html><html lang='en'><head><meta charset='utf-8'>",
        f"<title>Market Tide - the morning brief, {e(day_txt)}</title>",
        f"<link rel='stylesheet' href='{FONTS}'>",
        f"<style>{CSS}</style></head><body>",
    ]

    # ---- cover
    out.append(f"""
<div class="cover">
  <div class="mark"><i></i> Market Tide</div>
  <h1 class="serif">The morning brief</h1>
  <div class="rule"></div>
  <div class="date">{e(day_txt)}</div>
  <p class="blurb">Every day, we sift through all the announcements filed with
     NSE &amp; BSE.</p>
  <p class="blurb">In this newsletter, we bring you the Top {len(picked)} most
     important announcements from yesterday &mdash; what happened, the key
     numbers, and why it matters.</p>
  <p class="blurb">To read all the important announcements, visit
     <b>markettide.in</b>.</p>
  <div class="figs">
    <div class="fig"><b>{indian(meta.get('scanned') or 0)}</b><span>filed on NSE &amp; BSE</span></div>
    <div class="fig"><b>{indian(len(rows))}</b><span>worth reading</span></div>
    <div class="fig"><b>{len(picked)}</b><span>in this brief</span></div>
    <div class="fig"><b>{companies}</b><span>companies</span></div>
  </div>
</div>""")

    # ---- contents
    out.append(f"""
<div class="masthead"><div class="n serif">The morning brief</div>
  <div class="d">{e(day_txt)}</div></div>
<div class="toc"><h2 class="serif">What's inside</h2><ol>""")
    for tag, items in sections:
        out.append(f"<li>{e(tag)} <span>{len(items)}</span></li>")
    out.append("</ol></div>")

    # ---- the filings
    out.append(f"""<div class="masthead"><div class="n serif">The morning brief</div>
  <div class="d">{e(day_txt)}</div></div>""")

    for tag, items in sections:
        out.append('<div class="sec"><div class="sec-h">'
                   f'<h2 class="serif">{e(tag)}</h2>'
                   f'<span class="n">{len(items)}</span><span class="line"></span></div>')
        for r in items:
            mcap = crore(r.get("mcap"))
            out.append('<div class="item"><div class="top">'
                       f'<span class="co">{e(r.get("company"))}</span>')
            if mcap:
                out.append(f'<span class="mcap">{e(mcap)}</span>')
            out.append(f'<span class="ex">{e(r.get("exchange"))}</span></div>')
            out.append(f'<p>{e(r.get("summary"))}</p>')
            nums = [n for n in (r.get("key_numbers") or []) if n][:6]
            if nums:
                out.append('<div class="nums">'
                           + "".join(f"<span>{e(n)}</span>" for n in nums)
                           + "</div>")
            if r.get("why_it_matters"):
                out.append(f'<div class="why">{e(r["why_it_matters"])}</div>')
            out.append("</div>")
        out.append("</div>")

    out.append(f"""
<div class="end">
  <div class="end-top">
    <div>
      <b>Market Tide</b> reads every corporate announcement filed with NSE and
      BSE and summarises the ones that matter. The full searchable archive,
      including the filings left out of this brief, is at
      <b>{e(CONTACT['site'])}</b>.
    </div>
    <div class="end-contact">
      <span class="end-h">Get in touch</span>
      <span><a href="mailto:{e(CONTACT['email'])}">{e(CONTACT['email'])}</a></span>
      <span>{e(CONTACT['phone'])}</span>
      <span><a href="https://{e(CONTACT['site'])}">{e(CONTACT['site'])}</a></span>
      <span class="wa">
        <a href="{e(CONTACT['community'])}">{WA_LOGO} Join the WhatsApp community</a>
      </span>
    </div>
  </div>
  <div class="end-note">
    Summaries are written from the original filing and are for information only.
    They are not investment advice, and Market Tide is not a registered
    investment adviser. Always read the filing itself before acting.
  </div>
</div></body></html>""")
    return "\n".join(out), picked


# ------------------------------------------------------------------ storage

# Kept for two months. Long enough that a link shared in the group still opens
# weeks later, short enough that the store never grows without bound.
BRIEF_TTL = 60 * 86400
MAX_CHARS = 600_000        # inside Upstash's REST request limit, as publish.py


def _redis(url, token, command):
    """Use MongoDB first and keep Redis as an optional transition mirror."""
    import requests
    from mongo_mirror import configured, mirror_command, read_command
    operation = str(command[0]).upper() if command else ""
    if operation in {"GET", "MGET"} and configured():
        handled, result = read_command(command)
        if handled:
            return result
    mongo_result = False
    if operation in {"SET", "DEL"} and configured():
        mongo_result = mirror_command(command, "brief")
    if url and token:
        try:
            r = requests.post(url, headers={"Authorization": f"Bearer {token}",
                                            "Content-Type": "application/json"},
                              json=command, timeout=90)
            if not r.ok:
                raise RuntimeError(f"Redis {r.status_code}: {r.text[:200]}")
            return r.json().get("result")
        except Exception as error:
            if not mongo_result:
                raise
            print(f"  Redis transition mirror unavailable: {error}", file=sys.stderr)
    if mongo_result:
        return "OK" if operation == "SET" else 1
    raise RuntimeError("Neither MongoDB nor Redis storage is configured")


def store(day_iso, pdf_path, url, token):
    """Put the PDF where the website can serve it.

    Base64 in chunks, the same shape publish.py already uses for a heavy day,
    so there is no second storage service to pay for or keep alive.
    """
    import base64
    blob = base64.b64encode(open(pdf_path, "rb").read()).decode()
    key = f"mt:brief:{day_iso}"
    chunks = [blob[i:i + MAX_CHARS] for i in range(0, len(blob), MAX_CHARS)]
    for i, c in enumerate(chunks):
        _redis(url, token, ["SET", f"{key}:{i}", c, "EX", str(BRIEF_TTL)])
    _redis(url, token, ["SET", f"{key}:parts", str(len(chunks)), "EX", str(BRIEF_TTL)])

    try:
        raw = _redis(url, token, ["GET", "mt:brief:index"])
        days = json.loads(raw) if raw else []
    except Exception:
        days = []
    # Only the newest issue is offered. A daily brief is a thing you read the
    # morning it lands, not an archive you browse - and an archive invites the
    # question of why yesterday's is still being advertised. Older issues are
    # dropped from the index and their chunks deleted, so nothing lingers in
    # the store paying rent.
    old_days = [d for d in days if d != day_iso]
    for d in old_days:
        try:
            n = int(_redis(url, token, ["GET", f"mt:brief:{d}:parts"]) or 0)
            for i in range(n):
                _redis(url, token, ["DEL", f"mt:brief:{d}:{i}"])
            _redis(url, token, ["DEL", f"mt:brief:{d}:parts"])
        except Exception:
            pass
    _redis(url, token, ["SET", "mt:brief:index", json.dumps([day_iso]),
                        "EX", str(BRIEF_TTL)])
    return len(chunks), len(old_days)


# ---------------------------------------------------------------------- Kit

def email_body(day_txt, count, day_iso):
    link = f"https://markettide.in/brief/{day_iso}"
    return (
        f"The morning brief for {day_txt} is ready.\n\n"
        f"Every day we sift through all the announcements filed with NSE & BSE. "
        f"This issue carries the top {count} from yesterday - what happened, the "
        f"key numbers, and why it matters.\n\n"
        f"Read it online: {link}\n"
        f"Every important announcement, searchable: https://markettide.in\n\n"
        f"Market Tide summarises public exchange filings. It is not investment "
        f"advice. Always read the filing itself before acting.\n"
    )


def send_kit_broadcast(day_iso, count, api_key, from_addr):
    """Create one Kit broadcast to every active subscriber."""
    import requests

    day_txt = pretty_day(day_iso)
    link = f"https://markettide.in/brief/{day_iso}"
    text = email_body(day_txt, count, day_iso)
    html = (
        f"<p>The morning brief for <strong>{day_txt}</strong> is ready.</p>"
        f"<p>We sifted through NSE and BSE announcements and selected the top "
        f"{count} filings that matter.</p>"
        f'<p><a href="{link}">Read today\'s Daily Brief</a></p>'
        f"<p>Market Tide summarises public exchange filings. It is not investment advice.</p>"
    )
    payload = {
        "subject": f"The morning brief - {day_txt}",
        "description": f"Market Tide Daily Brief for {day_txt}",
        "content": html,
        "public": False,
        "published_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "send_at": (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=1)).isoformat(),
        "preview_text": text.split("\n\n", 1)[1][:140],
        "email_address": from_addr,
    }
    r = requests.post(
        "https://api.kit.com/v4/broadcasts",
        headers={"X-Kit-Api-Key": api_key, "Content-Type": "application/json"},
        json=payload,
        timeout=45,
    )
    if not r.ok:
        raise RuntimeError(f"Kit {r.status_code}: {r.text[:200]}")
    return r.json()


# ---------------------------------------------------------------------- pdf

def find_chrome():
    for c in CHROME_CANDIDATES:
        if not c:
            continue
        if os.path.exists(c):
            return c
        found = shutil.which(c)
        if found:
            return found
    return None


def to_pdf(html_path, pdf_path):
    chrome = find_chrome()
    if not chrome:
        print("  no Chrome found - set CHROME_PATH. HTML written, PDF skipped.")
        return False
    url = "file:///" + os.path.abspath(html_path).replace("\\", "/")
    cmd = [chrome, "--headless", "--disable-gpu", "--no-sandbox",
           "--no-pdf-header-footer", "--virtual-time-budget=12000",
           f"--print-to-pdf={os.path.abspath(pdf_path)}", url]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    if not os.path.exists(pdf_path):
        print("  Chrome did not write a PDF:", (r.stderr or "")[:300])
        return False
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--day", help="issue date (YYYY-MM-DD). Default: today in IST.")
    ap.add_argument("--count", type=int, default=50)
    ap.add_argument("--source", help="read a saved API response instead of the network")
    ap.add_argument("--out", default=OUT_DIR)
    ap.add_argument("--html-only", action="store_true")
    ap.add_argument("--publish", action="store_true",
                    help="put the PDF in the KV store so the site can serve it")
    args = ap.parse_args()

    # The window starts at the beginning of yesterday, so there is no reason to
    # page back beyond it. Without this the fetch walks all 159 pages of the
    # week every morning to use two days of them.
    issue_day = args.day or datetime.datetime.now(IST).date().isoformat()
    earliest = (datetime.date.fromisoformat(issue_day)
                - datetime.timedelta(days=1)).isoformat()

    rows, meta = fetch(None, args.source, earliest=earliest)
    if not rows:
        sys.exit("the API returned no filings")

    rows, day_iso = window(rows, args.day)
    if not rows:
        sys.exit(f"nothing filed in the window ending {day_iso} 06:45")

    doc, picked = render(rows, day_iso, meta, args.count)
    os.makedirs(args.out, exist_ok=True)
    html_path = os.path.join(args.out, f"brief-{day_iso}.html")
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(doc)
    print(f"{len(picked)} filings from {len(rows)} -> {html_path}")

    if args.html_only:
        return

    pdf_path = os.path.join(args.out, f"brief-{day_iso}.pdf")
    if not to_pdf(html_path, pdf_path):
        sys.exit("could not print the PDF")
    kb = os.path.getsize(pdf_path) // 1024
    print(f"  PDF: {pdf_path}  ({kb} KB)")

    if args.publish:
        url = os.environ.get("KV_REST_API_URL")
        token = os.environ.get("KV_REST_API_TOKEN")
        if not ((url and token) or os.environ.get("MONGODB_URI")):
            sys.exit("  --publish needs MONGODB_URI or Redis credentials")
        parts, held = store(day_iso, pdf_path, url, token)
        print(f"  published as {parts} part(s); {held} older issue(s) removed")
        print(f"  https://markettide.in/brief/{day_iso}")

        delivery = os.environ.get("NEWSLETTER_DELIVERY", "substack").strip().lower()
        kit_key = os.environ.get("KIT_API_KEY")
        if delivery == "kit" and kit_key:
            from_addr = os.environ.get("KIT_FROM_EMAIL", "market.tide27@gmail.com")
            broadcast = send_kit_broadcast(day_iso, len(picked), kit_key, from_addr)
            broadcast_id = broadcast.get("broadcast", {}).get("id") or broadcast.get("id", "created")
            print(f"  Kit broadcast scheduled: {broadcast_id}")
        elif delivery == "substack":
            print("  Substack delivery: issue prepared for manual scheduling at 08:00 IST")
        else:
            print(f"  Newsletter delivery skipped: provider '{delivery}' is not configured")


if __name__ == "__main__":
    main()
