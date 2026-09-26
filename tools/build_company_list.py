"""
The company list the portfolio search box looks things up in.

A reader adding stocks needs to find them by typing "relia", which means we
need every listed company's real NAME - and neither list we already keep can
give us one. bse_scrips.json holds normalised keys ("abbindia"), because all
it was ever for was matching a filing to a scrip code, and mcap.json holds
market caps under the same flattened keys. Neither can be shown to a person.

The same BSE endpoint mcap.py already calls carries everything we need, and we
were keeping one field out of eight: the display name, the ticker, the ISIN
and the group are all in there.

    python tools/build_company_list.py

Writes web/data/companies.json, which the web app imports at build time. It is
committed, so a deploy never depends on BSE being reachable, and a reader
searching for a stock never waits on an upstream API. Re-run it when new
companies list - once a month is plenty.

Two things this gets right that cost an hour to find out:

1. "segment=SMEandOthers" is not the SME board. It is EVERYTHING - 12,791 rows
   of equities, debentures, commercial paper, government securities and mutual
   fund units. The real segment is a field on each row. Asking for
   "segment=Equity" instead returns 5,048 rows and silently leaves out every
   SME company, which is how the first version of this produced a list with
   nothing from the SME board in it at all.

2. The SME board is the GROUP field, not the segment. BSE files SME companies
   as Segment "Equity" with GROUP "M" or "MT" - 525 of the 581 scrips in
   sme_scrips.json are found exactly that way.

Known gap: this is BSE's list, so a company listed only on NSE Emerge is not in
it. Those are the same companies that have never had a market cap on the SME
dashboard, for the same reason - there is no BSE record to read it from.
"""

import json
import os
import re
import sys

import requests

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)

import mcap                                              # noqa: E402

OUT = os.path.join(HERE, "web", "data", "companies.json")

# BSE's group codes for the SME board.
SME_GROUPS = {"M", "MT"}

# An equity ISIN carries "01" in positions 8-9: INE117A01022 is ABB India's
# equity, INE117A07xxx would be its debentures. Without this the list fills up
# with debt series and a reader searching for "Tata Steel" is offered four
# Tata Steel debentures. INF... is a mutual fund and goes the same way.
EQUITY_ISIN = re.compile(r"^INE\w{4}01", re.I)


def fetch(log=print):
    """Every active scrip BSE will admit to, in one request."""
    try:
        r = requests.get(mcap.MASTER_URL,
                         params={"Group": "", "Scripcode": "", "industry": "",
                                 "segment": "SMEandOthers", "status": "Active"},
                         headers=mcap.HEADERS, timeout=120)
        rows = r.json() if r.status_code == 200 else []
    except Exception as e:
        log(f"  could not fetch the BSE scrip list: {e}")
        return []
    log(f"  BSE returned {len(rows)} scrips")
    return rows


def build(log=print):
    by_isin = {}
    for row in fetch(log=log):
        if str(row.get("Segment") or "").strip() != "Equity":
            continue

        isin = str(row.get("ISIN_NUMBER") or "").strip().upper()
        code = str(row.get("SCRIP_CD") or "").strip()
        # Issuer_Name is the legal name ("Aegis Logistics Ltd."), Scrip_Name
        # the one BSE shows ("Aegis Logistics Ltd"). The second reads better
        # and matches what the filings say.
        name = (row.get("Scrip_Name") or row.get("Issuer_Name") or "").strip()
        ticker = str(row.get("scrip_id") or "").strip().upper()

        if not (isin and code.isdigit() and name):
            continue
        if not EQUITY_ISIN.match(isin):
            continue
        if isin in by_isin:
            continue

        try:
            cr = round(float(row.get("Mktcap") or 0), 2) or None
        except (TypeError, ValueError):
            cr = None

        by_isin[isin] = {
            "isin": isin,
            "code": code,
            "name": name,
            "ticker": ticker,
            "board": "SME" if str(row.get("GROUP") or "").strip().upper()
                     in SME_GROUPS else "Main",
            # The key a filing is matched on. Computed here so the web app
            # never recomputes it for 5,000 companies on every keystroke, and
            # so it cannot drift from what mcap.py uses to match filings.
            "key": mcap.norm(name),
            **({"cr": cr} if cr else {}),
        }

    # Biggest first, so a search for "tata" offers Tata Motors before Tata
    # Teleservices (Maharashtra), and an unqualified match is usually the one
    # meant.
    rows = sorted(by_isin.values(), key=lambda r: -(r.get("cr") or 0))
    sme = sum(1 for r in rows if r["board"] == "SME")
    log(f"  {len(rows)} companies ({sme} SME, {len(rows) - sme} main board)")
    return rows


def main():
    rows = build()
    # A bad fetch must not quietly replace a good list with a short one.
    if len(rows) < 3000:
        print(f"Only {len(rows)} companies - refusing to overwrite the list.")
        return 1
    if not any(r["board"] == "SME" for r in rows):
        print("No SME companies found - refusing to overwrite the list.")
        return 1

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Wrote {OUT} ({os.path.getsize(OUT) / 1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
