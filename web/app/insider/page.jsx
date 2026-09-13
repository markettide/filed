"use client";

import { useEffect, useMemo, useState } from "react";
import Nav from "../Nav";
import {
  byCompany, byDay, count, dayLabel, mcapLabel, mcapTier, money, name, pct,
  price,
} from "../fmt";

const PAGE = 10;

// Rows shown on a company card before the rest fold away.
const PER_CARD = 5;

const ROLES = [
  ["all", "Everyone"],
  ["promoter", "Promoters"],
  ["director", "Directors"],
  ["kmp", "Key management"],
  ["employee", "Employees"],
  ["relative", "Family"],
];

// What one share went for. The filing states a total and never a price, so
// rows stored before we worked it out have no `price` field and it is derived
// here instead. It is the number you can hold against today's share price.
function each(row) {
  return (
    Number(row.price) ||
    (Number(row.shares) ? Number(row.value) / Number(row.shares) : 0)
  );
}

// A pledge is not a purchase. Nobody paid ₹70.38 a share to pledge shares they
// already own, so a price on a pledge row would be an invented number.
function isPledge(side) {
  const s = (side || "").toLowerCase();
  return ["pledge", "encumbr", "revoke", "invoke"].some((k) => s.includes(k));
}

// The form's wording, in English. "Market Purchase" is a field name.
const HOWS = [
  ["market purchase", "on the open market"],
  ["market sale", "on the open market"],
  ["open market", "on the open market"],
  ["off market", "off market"],
  ["inheritance", "by inheritance"],
  ["gift", "as a gift"],
  ["allotment", "through an allotment"],
  ["conversion", "on conversion"],
  ["preferential", "through a preferential issue"],
  ["rights", "through a rights issue"],
  ["pledge", ""],
  ["invocation", ""],
  ["other", ""],
];

function how(mode) {
  const m = (mode || "").trim().toLowerCase();
  if (!m) return "";
  const hit = HOWS.find(([k]) => m.includes(k));
  return hit ? hit[1] : m;
}

// Who the person is, in words rather than in the exchange's shorthand.
const ROLE_WORDS = [
  ["promoter and director", "promoter and director"],
  ["promoter group", "promoter group"],
  ["promoter", "promoter"],
  ["immediate relative", "family of an insider"],
  ["relative", "family of an insider"],
  ["key managerial", "senior management"],
  ["designated", "senior employee"],
  ["director", "director"],
  ["employee", "employee"],
  ["trust", "trust"],
];

function roleWords(category) {
  const c = (category || "").trim().toLowerCase();
  if (!c) return "";
  const hit = ROLE_WORDS.find(([k]) => c.includes(k));
  return hit ? hit[1] : c;
}

// The badge. The filing says "Pledge Revoke"; a reader should see "Released".
const SIDES = [
  ["pledge revoke", ["Pledge released", "neu"]],
  ["pledge release", ["Pledge released", "neu"]],
  ["pledge invoke", ["Pledge invoked", "neg"]],
  ["pledge creation", ["Pledged", "neu"]],
  ["revoke", ["Pledge released", "neu"]],
  ["invoke", ["Pledge invoked", "neg"]],
  ["encumbrance", ["Encumbered", "neu"]],
  ["pledge", ["Pledged", "neu"]],
  ["buy", ["Bought", "pos"]],
  ["acquisition", ["Bought", "pos"]],
  ["sell", ["Sold", "neg"]],
  ["disposal", ["Sold", "neg"]],
];

function badge(side) {
  const s = (side || "").trim().toLowerCase();
  if (!s) return ["Traded", "neu"];
  const hit = SIDES.find(([k]) => s.includes(k));
  return hit ? hit[1] : [side, "neu"];
}

function roleClass(row) {
  const c = (row.category || "").toLowerCase();
  if (c.includes("promoter")) return "promoter";
  if (c.includes("director")) return "director";
  return "";
}

// What a card of several trades adds up to. This total IS meaningful, unlike
// one across unrelated companies: it is one company, one day, one direction.
function sumUp(rows) {
  const total = (list) => list.reduce((s, r) => s + (Number(r.value) || 0), 0);
  const bits = [];
  for (const [tone, word] of [["pos", "bought"], ["neg", "sold"]]) {
    const list = rows.filter((r) => badge(r.side)[1] === tone);
    if (!list.length) continue;
    const sum = money(total(list));
    bits.push(`${list.length} ${word}${sum ? ` · ${sum}` : ""}`);
  }
  return bits.join("    ");
}

export default function InsiderPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [side, setSide] = useState("all");
  const [who, setWho] = useState("all");
  const [q, setQ] = useState("");
  const [day, setDay] = useState("all");
  const [days, setDays] = useState("7");
  const [shown, setShown] = useState(PAGE);

  // One filing. Defined HERE, inside the component, and not as a component of
  // its own: styled-jsx only scopes its rules to JSX owned by the component
  // that holds the <style jsx> tag, so a row drawn elsewhere would come out
  // with none of the styles below applied.
  const renderRow = (t) => {
    const [label, tone] = badge(t.side);
    const per = each(t);

    // Two shapes of row. The structured filing gives fields - who, how many,
    // at what, by what route. Our own read of the same document gives a
    // sentence. Rather than draw a field row full of blanks, a sentence is
    // drawn as a sentence.
    if (!t.who) {
      return (
        <li key={t.id} className="t">
          <p className="summary">{t.headline}</p>
        </li>
      );
    }

    return (
      <li key={t.id} className="t">
        <div className="t-top">
          <span className="person">
            {name(t.who)}
            {roleWords(t.category) ? (
              <span className={`role ${roleClass(t)}`}>
                {roleWords(t.category)}
              </span>
            ) : null}
          </span>
          <span className="right">
            <span className={`b ${tone}`}>{label}</span>
            {t.value ? <span className="amt">{money(t.value)}</span> : null}
          </span>
        </div>
        <p className="line">
          {t.shares ? (
            <span className="qty">{count(t.shares)} shares</span>
          ) : null}
          {per && !isPledge(t.side) ? <span>at {price(per)} each</span> : null}
          {how(t.mode) ? <span>{how(t.mode)}</span> : null}
          {pct(t.after_pct) ? <span>holds {pct(t.after_pct)} after</span> : null}
        </p>
      </li>
    );
  };

  const query = useMemo(() => {
    const p = new URLSearchParams({ days, side, role: who });
    if (day !== "all") p.set("day", day);
    if (q.trim()) p.set("q", q.trim());
    return p.toString();
  }, [side, who, q, day, days]);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError("");
    fetch(`/api/insider?${query}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch(() => alive && setError("Could not load insider trades."))
      .finally(() => alive && setShown(PAGE));
    return () => {
      alive = false;
    };
  }, [query]);

  const items = data?.items || [];

  // Day first, then company inside the day. A card is one company on one day.
  const grouped = useMemo(
    () =>
      byDay(items.slice(0, shown)).map((d) => ({
        ...d,
        companies: byCompany(d.rows),
      })),
    [items, shown]
  );

  // Pledging a stake and freeing one are opposite events, and the API's
  // buy/sell counts cannot tell them apart - both sides are "pledge"
  // something. Counted here off the rows the page already has.
  const pledged = useMemo(() => {
    let made = 0;
    let freed = 0;
    for (const t of items) {
      const label = badge(t.side)[0].toLowerCase();
      if (label.includes("released")) freed += 1;
      else if (label.includes("pledged") || label.includes("encumbered"))
        made += 1;
    }
    return { made, freed };
  }, [items]);

  // How many rows each day contributes, for the number on its
  // chip. Counted off the rows already loaded, so it follows the
  // other filters - and it is only meaningful while showing all
  // days, which is the only time the chips need it.
  const perDay = useMemo(() => {
    const n = {};
    for (const r of items) n[r.day] = (n[r.day] || 0) + 1;
    return n;
  }, [items]);

  const counts = data?.counts;

  return (
    <>
      <Nav />
      <main className="wrap insider-page">
        <header className="head">
          <h1>Who&rsquo;s buying their own shares</h1>
          <p className="lede">
            A promoter, a director or senior staff buying or selling shares in
            their own company has to tell the exchange. This is that list
            &mdash; who, how many, and at what price.
          </p>
          <p className="aside">
            Left out on purpose: employee stock schemes, company welfare trusts,
            and shares moving between members of one promoter family. None of
            those is anyone deciding what the shares are worth.
          </p>
        </header>

        {/* Counts, not rupee totals. A total here would add up buying across
            two hundred unrelated companies, and the same ₹177 Cr can be one
            block in one company or two hundred small trades. */}
        {counts ? (
          <section className="tally">
            {/* "0 bought, 0 sold" is not a summary of a pledge list. Under
                that tab the two numbers a reader wants are how many stakes
                were pledged and how many were freed. */}
            {side === "pledge" ? (
              <>
                <div className="t-card neg">
                  <span className="t-n">{pledged.made}</span>
                  <span className="t-l">pledged</span>
                </div>
                <div className="t-card pos">
                  <span className="t-n">{pledged.freed}</span>
                  <span className="t-l">released</span>
                </div>
              </>
            ) : (
              <>
                <div className="t-card pos">
                  <span className="t-n">{counts.buys}</span>
                  <span className="t-l">bought</span>
                </div>
                <div className="t-card neg">
                  <span className="t-n">{counts.sells}</span>
                  <span className="t-l">sold</span>
                </div>
              </>
            )}
            <div className="t-card">
              <span className="t-n">{counts.total}</span>
              {/* The window is a choice now, and a single day is
                  not a window at all. */}
              <span className="t-l">
                {day === "all" ? `in the last ${days} days` : "on this day"}
              </span>
            </div>
          </section>
        ) : null}

        <section className="controls" aria-label="Filter insider trades">
          <div className="seg type-seg" role="group" aria-label="Transaction type">
            {[
              ["all", "Buying & selling"],
              ["buy", "Buying"],
              ["sell", "Selling"],
              ["pledge", "Pledges"],
            ].map(([k, l]) => (
              <button
                key={k}
                type="button"
                className={side === k ? "on" : ""}
                aria-pressed={side === k}
                onClick={() => setSide(k)}
              >
                {l}
                {k === "pledge" && counts?.pledges ? (
                  <span className="n">{counts.pledges}</span>
                ) : null}
              </button>
            ))}
          </div>
          <div className="seg wrapseg" role="group" aria-label="Insider role">
            {ROLES.map(([k, l]) => (
              <button
                key={k}
                type="button"
                className={who === k ? "on" : ""}
                aria-pressed={who === k}
                onClick={() => setWho(k)}
              >
                {l}
              </button>
            ))}
          </div>
          <input
            className="search"
            type="search"
            aria-label="Search insider trades"
            placeholder="Search a company or a person"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {/* Whatever is on screen, as a spreadsheet - same filters, same
              days. A plain link, so the browser downloads it. */}
          <a className="dl" aria-label="Download filtered insider trades as Excel" href={`/api/insider?${query}&format=xlsx`}>
            <span aria-hidden="true">&darr;</span> Excel
          </a>
        </section>

        {side === "pledge" ? (
          <p className="explain">
            A pledge is a promoter borrowing against shares they already own,
            and a release is that loan being paid back. Nobody bought or sold
            anything, so these sit apart from the trades &mdash; but the amounts
            are large, and a promoter pledging most of their stake is worth
            knowing.
          </p>
        ) : null}

        {error ? <p className="empty">{error}</p> : null}
        {!error && !data ? <p className="empty">Loading&hellip;</p> : null}
        {data && !items.length ? (
          <p className="empty">
            Nothing matches that. Companies file these through the trading day,
            so mornings are often quiet.
          </p>
        ) : null}

        {/* Date filter. The exchanges publish these after each close, so
            "what happened on Thursday" is a real question - and one the
            seven-day window on its own could not answer. Days come from the
            API's own index, so a day with nothing in it is never offered. */}
        {data?.days?.length ? (
          <section className="dates" aria-label="Filter insider trades by day">
            <span className="lbl">Day</span>
            <button
              type="button"
              className={`chip ${day === "all" ? "on" : ""}`}
              aria-pressed={day === "all"}
              onClick={() => setDay("all")}
            >
              All
            </button>
            {data.days.map((d) => (
              <button
                key={d}
                type="button"
                className={`chip ${day === d ? "on" : ""}`}
                aria-pressed={day === d}
                onClick={() => setDay(d)}
              >
                {dayLabel(d)}
                {perDay[d] ? <span className="n">{perDay[d]}</span> : null}
              </button>
            ))}
            <select
              className="win"
              value={days}
              onChange={(e) => {
                setDays(e.target.value);
                setDay("all");
              }}
              aria-label="How far back to look"
            >
              <option value="7">Last 7 days</option>
              <option value="14">Last 14 days</option>
              <option value="30">Last 30 days</option>
            </select>
          </section>
        ) : null}

        {grouped.map((g) => (
          <section key={g.day} className="day">
            <h2 className="day-head">
              <span>{dayLabel(g.day)}</span>
              <span className="day-n">
                {g.rows.length} {g.rows.length === 1 ? "filing" : "filings"}
              </span>
            </h2>

            {g.companies.map((c) => {
              const tones = new Set(c.rows.map((r) => badge(r.side)[1]));
              const tone = tones.size === 1 ? [...tones][0] : "mixed";
              // Past a handful of rows the rest fold away, so the next
              // company is still on screen. <details> rather than React
              // state: no wiring, and it works before hydration.
              const head = c.rows.slice(0, PER_CARD);
              const rest = c.rows.slice(PER_CARD);
              return (
                <article key={c.key} className={`card tone-${tone}`}>
                  <div className="co-line">
                    <span className="co">{name(c.company)}</span>
                    {mcapLabel(c.mcap) ? (
                      <span className={`mcap ${mcapTier(c.mcap)}`}>
                        {mcapLabel(c.mcap)}
                      </span>
                    ) : null}
                    {c.rows.length > 1 ? (
                      <span className="roll">{sumUp(c.rows)}</span>
                    ) : null}
                  </div>

                  <ul className="trades">
                    {head.map(renderRow)}
                  </ul>

                  {rest.length ? (
                    <details className="rest">
                      <summary>{rest.length} more at this company</summary>
                      <ul className="trades">
                        {rest.map(renderRow)}
                      </ul>
                    </details>
                  ) : null}
                </article>
              );
            })}
          </section>
        ))}

        {data && items.length > shown ? (
          <button
            className="more"
            type="button"
            onClick={() => setShown(shown + PAGE)}
          >
            Show {Math.min(PAGE, items.length - shown)} more
          </button>
        ) : null}

        <p className="verify">
          Straight from what companies file with NSE and BSE under SEBI&rsquo;s
          Regulation 7(2). Rows with a named person and a share count come from
          the structured filing; the rest are the same disclosure read from the
          document. Nothing here is advice.
        </p>
      </main>

      <style jsx global>{`
        .insider-page { padding-bottom: 72px; }
        .insider-page .head { padding-top: 26px; }
        .insider-page .head h1 {
          margin: 0 0 10px;
          font-size: 29px;
          line-height: 1.2;
          letter-spacing: -0.025em;
        }
        .insider-page .lede {
          margin: 0 0 12px;
          font-size: 16px;
          line-height: 1.6;
          color: var(--muted);
          max-width: 60ch;
        }
        .insider-page .aside {
          margin: 0 0 22px;
          font-size: 13.5px;
          line-height: 1.6;
          color: var(--dim);
          border-left: 2px solid var(--line);
          padding-left: 13px;
          max-width: 60ch;
        }
        .insider-page .explain {
          margin: -8px 0 18px;
          font-size: 13.5px;
          line-height: 1.6;
          color: var(--muted);
          background: var(--panel);
          border: 1px solid var(--line);
          border-radius: 11px;
          padding: 11px 14px;
          max-width: 70ch;
        }

        .insider-page .tally { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 18px; }
        .insider-page .t-card {
          flex: 1 1 130px;
          background: var(--panel);
          border: 1px solid var(--line);
          border-radius: 13px;
          padding: 13px 15px;
          display: flex;
          flex-direction: column;
          gap: 1px;
        }
        .insider-page .t-card.pos { border-color: color-mix(in srgb, var(--pos) 35%, var(--line)); }
        .insider-page .t-card.neg { border-color: color-mix(in srgb, var(--neg) 35%, var(--line)); }
        .insider-page .t-n {
          font-size: 27px;
          font-weight: 680;
          letter-spacing: -0.03em;
          font-variant-numeric: tabular-nums;
        }
        .insider-page .t-card.pos .t-n { color: var(--pos); }
        .insider-page .t-card.neg .t-n { color: var(--neg); }
        .insider-page .t-l { font-size: 12.5px; color: var(--dim); }

        .insider-page .controls { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 22px; }
        .insider-page .seg {
          display: inline-flex;
          border: 1px solid var(--line);
          border-radius: 10px;
          overflow: hidden;
          background: var(--panel);
        }
        .insider-page .seg.wrapseg { flex-wrap: wrap; }
        .insider-page .seg button {
          border: 0;
          background: transparent;
          color: var(--muted);
          padding: 7px 13px;
          cursor: pointer;
          font: inherit;
          font-size: 13px;
          border-right: 1px solid var(--line);
          transition: background .12s ease, color .12s ease;
        }
        .insider-page .seg button:last-child { border-right: 0; }
        .insider-page .seg button:hover { background: var(--panel-2); color: var(--ink); }
        .insider-page .seg button.on { background: var(--ink); color: var(--bg); font-weight: 600; }
        .insider-page .seg button .n {
          margin-left: 6px;
          font-size: 11px;
          opacity: 0.6;
          font-variant-numeric: tabular-nums;
        }
        .insider-page .search {
          flex: 1 1 180px;
          min-width: 160px;
          padding: 7px 13px;
          border: 1px solid var(--line);
          border-radius: 10px;
          background: var(--panel);
          color: var(--ink);
          font: inherit;
          font-size: 13px;
        }
        .insider-page .search::placeholder { color: var(--dim); }
        .insider-page .search:focus {
          outline: none;
          border-color: color-mix(in srgb, var(--accent) 55%, var(--line));
        }
        .insider-page .dl {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 7px 14px;
          border: 1px solid var(--line);
          border-radius: 10px;
          background: var(--panel);
          color: var(--muted);
          font-size: 13px;
          text-decoration: none;
          white-space: nowrap;
        }
        .insider-page .dl:hover { background: var(--panel-2); color: var(--ink); }

        .insider-page .day { margin-bottom: 26px; }
        .insider-page .day-head {
          display: flex;
          align-items: baseline;
          gap: 9px;
          margin: 0 0 11px;
          font-size: 12px;
          font-weight: 680;
          letter-spacing: 0.07em;
          text-transform: uppercase;
          color: var(--dim);
        }
        .insider-page .day-head::after {
          content: "";
          flex: 1;
          height: 1px;
          background: var(--line);
        }
        .insider-page .day-n {
          font-size: 11.5px;
          letter-spacing: 0;
          text-transform: none;
          font-weight: 600;
          color: var(--dim);
          background: var(--panel-2);
          border-radius: 999px;
          padding: 1px 8px;
          order: 3;
        }

        .insider-page .card {
          background: var(--panel);
          border: 1px solid var(--line);
          border-left: 3px solid var(--line);
          border-radius: 13px;
          padding: 13px 17px 14px;
          margin-bottom: 9px;
          transition: border-color .15s ease;
        }
        .insider-page .card:hover {
          border-color: color-mix(in srgb, var(--accent) 35%, var(--line));
        }
        .insider-page .card.tone-pos { border-left-color: var(--pos); }
        .insider-page .card.tone-neg { border-left-color: var(--neg); }
        .insider-page .card.tone-mixed {
          border-left-color: color-mix(in srgb, var(--pos) 50%, var(--neg));
        }
        .insider-page .card:hover.tone-pos { border-left-color: var(--pos); }
        .insider-page .card:hover.tone-neg { border-left-color: var(--neg); }

        .insider-page .co-line {
          display: flex;
          align-items: baseline;
          gap: 8px;
          flex-wrap: wrap;
        }
        .insider-page .co { font-size: 16px; font-weight: 670; letter-spacing: -0.015em; }
        .insider-page .mcap {
          font-size: 11.5px;
          font-weight: 600;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .insider-page .mcap.lg { color: var(--accent); }
        .insider-page .mcap.md { color: var(--muted); }
        .insider-page .mcap.sm { color: var(--dim); }
        /* What eleven rows at one company add up to. Shown only when there is
           more than one, because otherwise it just repeats the row below. */
        .insider-page .roll {
          margin-left: auto;
          font-size: 12px;
          color: var(--dim);
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }

        .insider-page .trades { list-style: none; margin: 0; padding: 0; }
        .insider-page .rest { margin: 0; }
        .insider-page .rest > summary {
          cursor: pointer;
          list-style: none;
          font-size: 12.5px;
          color: var(--muted);
          padding: 9px 0 1px;
        }
        .insider-page .rest > summary::-webkit-details-marker { display: none; }
        .insider-page .rest > summary::before { content: "+ "; opacity: 0.7; }
        .insider-page .rest[open] > summary::before { content: "− "; }
        .insider-page .rest > summary:hover { color: var(--ink); }

        .insider-page .t { padding-top: 9px; }
        .insider-page .t + .t { margin-top: 9px; border-top: 1px solid var(--line); }
        .insider-page .t-top {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 12px;
        }
        .insider-page .person { font-size: 14px; color: var(--ink); min-width: 0; }
        .insider-page .role { margin-left: 7px; color: var(--dim); font-size: 12px; }
        .insider-page .role.promoter { color: #9b7cff; }
        .insider-page .role.director { color: var(--accent); }
        .insider-page .right {
          display: flex;
          align-items: baseline;
          gap: 9px;
          flex-shrink: 0;
        }
        .insider-page .b {
          font-size: 11.5px;
          font-weight: 650;
          padding: 3px 9px;
          border-radius: 999px;
          background: var(--panel-2);
          color: var(--muted);
          white-space: nowrap;
        }
        .insider-page .b.pos { background: var(--pos-bg); color: var(--pos); }
        .insider-page .b.neg { background: var(--neg-bg); color: var(--neg); }
        .insider-page .amt {
          font-size: 15.5px;
          font-weight: 680;
          letter-spacing: -0.02em;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
          min-width: 94px;
          text-align: right;
        }

        .insider-page .line {
          margin: 4px 0 0;
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          font-size: 12.5px;
          color: var(--dim);
          font-variant-numeric: tabular-nums;
        }
        .insider-page .qty { color: var(--muted); }
        .insider-page .summary { margin: 0; font-size: 14px; line-height: 1.6; }

        .insider-page .dates {
          display: flex;
          gap: 7px;
          flex-wrap: wrap;
          align-items: center;
          margin-bottom: 10px;
        }
        .insider-page .dates .lbl {
          font-size: 11.5px;
          font-weight: 680;
          letter-spacing: 0.07em;
          text-transform: uppercase;
          color: var(--dim);
          margin-right: 2px;
        }
        .insider-page .chip {
          border: 1px solid var(--line);
          background: var(--panel);
          color: var(--muted);
          border-radius: 999px;
          padding: 5px 12px;
          font: inherit;
          font-size: 12.5px;
          cursor: pointer;
          transition: background .12s ease, color .12s ease;
        }
        .insider-page .chip:hover { background: var(--panel-2); color: var(--ink); }
        .insider-page .chip.on {
          background: var(--ink);
          color: var(--bg);
          border-color: var(--ink);
          font-weight: 600;
        }
        .insider-page .chip .n {
          margin-left: 6px;
          font-size: 11px;
          opacity: 0.6;
          font-variant-numeric: tabular-nums;
        }
        .insider-page .win {
          margin-left: auto;
          border: 1px solid var(--line);
          background: var(--panel);
          color: var(--muted);
          border-radius: 10px;
          padding: 5px 10px;
          font: inherit;
          font-size: 12.5px;
        }

        .insider-page .more {
          display: block;
          margin: 4px auto 0;
          padding: 9px 20px;
          border: 1px solid var(--line);
          border-radius: 10px;
          background: var(--panel);
          color: var(--muted);
          font: inherit;
          font-size: 13.5px;
          cursor: pointer;
        }
        .insider-page .more:hover { background: var(--panel-2); color: var(--ink); }
        .insider-page .empty { color: var(--dim); padding: 22px 0; line-height: 1.6; }
        .insider-page .verify {
          margin-top: 30px;
          color: var(--dim);
          font-size: 12.5px;
          line-height: 1.6;
          max-width: 66ch;
        }

        @media (max-width: 560px) {
          .insider-page .head h1 { font-size: 24px; }
          .insider-page .lede { font-size: 15px; }
          .insider-page .controls { gap: 10px; }
          .insider-page .seg {
            width: 100%;
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .insider-page .seg.wrapseg { grid-template-columns: repeat(3, minmax(0, 1fr)); }
          .insider-page .seg button {
            min-height: 44px;
            padding: 8px 6px;
            white-space: normal;
            line-height: 1.25;
          }
          .insider-page .seg button:nth-child(2n) { border-right: 0; }
          .insider-page .seg.wrapseg button:nth-child(2n) { border-right: 1px solid var(--line); }
          .insider-page .seg.wrapseg button:nth-child(3n) { border-right: 0; }
          .insider-page .search { min-width: 0; height: 44px; font-size: 16px; }
          .insider-page .dl { min-height: 44px; justify-content: center; }
          .insider-page .dates { gap: 6px; }
          .insider-page .chip, .insider-page .win { min-height: 40px; }
          .insider-page .win { margin-left: 0; }
          .insider-page .person, .insider-page .co { overflow-wrap: anywhere; }
          .insider-page .card { padding: 12px 14px 13px; }
          .insider-page .roll { margin-left: 0; width: 100%; }
          .insider-page .t-top { flex-direction: column; gap: 5px; }
          .insider-page .right { flex-direction: row-reverse; justify-content: flex-end; }
          .insider-page .amt { min-width: 0; text-align: left; }
        }
      `}</style>
    </>
  );
}
