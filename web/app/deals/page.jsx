"use client";

import { useEffect, useMemo, useState } from "react";
import Nav from "../Nav";
import {
  byCompany, byDay, count, dayLabel, mcapLabel, mcapTier, money, name, price,
} from "../fmt";

const PAGE = 10;

// Rows shown on a company card before the rest fold away.
const PER_CARD = 5;

export default function DealsPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [side, setSide] = useState("all");
  const [kind, setKind] = useState("all");
  const [exch, setExch] = useState("all");
  const [q, setQ] = useState("");
  const [day, setDay] = useState("all");
  const [days, setDays] = useState("7");
  const [shown, setShown] = useState(PAGE);

  // One investor's position. Defined HERE, inside the component, and not as a
  // component of its own: styled-jsx only scopes its rules to JSX owned by the
  // component that holds the <style jsx> tag, so a row drawn elsewhere would
  // come out with none of the styles below applied.
  const renderRow = (showKind) => (d) => {
    const bought = d.side === "Buy";
    const tone = bought ? "pos" : "neg";
    return (
      <li key={d.id} className="t">
        <div className="t-top">
          <span className="person">
            {name(d.who)}
            {showKind ? (
              <span className="role">
                {d.kind} deal &middot; {d.exchange}
              </span>
            ) : null}
          </span>
          <span className="right">
            <span className={`b ${tone}`}>{bought ? "Bought" : "Sold"}</span>
            {d.value ? <span className="amt">{money(d.value)}</span> : null}
          </span>
        </div>
        <p className="line">
          {d.shares ? (
            <span className="qty">{count(d.shares)} shares</span>
          ) : null}
          {price(d.price) ? <span>at {price(d.price)} each</span> : null}
          {d.netted ? (
            <span>
              net &mdash; also {bought ? "sold" : "bought"}{" "}
              {count((bought ? d.gross_sell : d.gross_buy) || 0)} the same day
            </span>
          ) : null}
          {/* The exchange prints a large block deal in BOTH reports. We keep
              the bulk row, because it is the client's whole day - but a
              block is negotiated off the order book, which is worth saying. */}
          {d.via_block ? <span>through the block window</span> : null}
        </p>
        {d.remarks ? <p className="line">{d.remarks}</p> : null}
      </li>
    );
  };

  const query = useMemo(() => {
    const p = new URLSearchParams({ days, side, kind, exchange: exch });
    if (day !== "all") p.set("day", day);
    if (q.trim()) p.set("q", q.trim());
    return p.toString();
  }, [side, kind, exch, q, day, days]);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError("");
    fetch(`/api/deals?${query}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch(() => alive && setError("Could not load bulk and block deals."))
      .finally(() => alive && setShown(PAGE));
    return () => {
      alive = false;
    };
  }, [query]);

  const items = data?.items || [];
  // Day first, then company inside the day. Both sides of a block deal are the
  // same company on the same day, so they belong in one card - as two separate
  // cards they read like a duplicate, and the story is lost. Granules on
  // 11 September is one promoter selling ₹1,160 Cr to thirteen funds.
  const grouped = useMemo(
    () =>
      byDay(items.slice(0, shown)).map((d) => ({
        ...d,
        companies: byCompany(d.rows),
      })),
    [items, shown]
  );
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
      <main className="wrap deals-page">
        <header className="head">
          <h1>The big trades, by name</h1>
          <p className="lede">
            When one investor buys or sells a large slice of a company in a
            single day, the exchange has to publish their name. Funds, family
            offices, promoters &mdash; this is who moved, and at what price.
          </p>
          <p className="aside">
            Day trading is taken out. Someone who buys and sells the same shares
            in one day gets reported twice and owns nothing by the close, so
            each name&rsquo;s trades in a company on a day are netted and the
            pure round trips dropped. Tiny deals go too &mdash; a bulk deal is
            half a percent of the company, which in a small one can be a few
            lakh rupees.
          </p>
        </header>

        {/* Counts, not rupee totals. A total here would add up buying across
            dozens of unrelated companies, which is not a number that means
            anything. */}
        {counts ? (
          <section className="tally">
            <div className="t-card pos">
              <span className="t-n">{counts.buys}</span>
              <span className="t-l">bought</span>
            </div>
            <div className="t-card neg">
              <span className="t-n">{counts.sells}</span>
              <span className="t-l">sold</span>
            </div>
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

        <section className="controls" aria-label="Filter bulk and block deals">
          <div className="seg" role="group" aria-label="Trade direction">
            {[["all", "All"], ["buy", "Buying"], ["sell", "Selling"]].map(
              ([k, l]) => (
                <button
                  key={k}
                  type="button"
                  className={side === k ? "on" : ""}
                  aria-pressed={side === k}
                  onClick={() => setSide(k)}
                >
                  {l}
                </button>
              )
            )}
          </div>
          <div className="seg" role="group" aria-label="Deal type">
            {[["all", "Both kinds"], ["bulk", "Bulk"], ["block", "Block"]].map(
              ([k, l]) => (
                <button
                  key={k}
                  type="button"
                  className={kind === k ? "on" : ""}
                  aria-pressed={kind === k}
                  onClick={() => setKind(k)}
                >
                  {l}
                </button>
              )
            )}
          </div>
          <div className="seg" role="group" aria-label="Exchange">
            {[["all", "Both exchanges"], ["NSE", "NSE"], ["BSE", "BSE"]].map(
              ([k, l]) => (
                <button
                  key={k}
                  type="button"
                  className={exch === k ? "on" : ""}
                  aria-pressed={exch === k}
                  onClick={() => setExch(k)}
                >
                  {l}
                </button>
              )
            )}
          </div>
          <input
            className="search"
            type="search"
            aria-label="Search bulk and block deals"
            placeholder="Search a company or an investor"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {/* Whatever is on screen, as a spreadsheet - same filters, same
              days. A plain link, so the browser downloads it. */}
          <a className="dl" aria-label="Download filtered bulk and block deals as Excel" href={`/api/deals?${query}&format=xlsx`}>
            <span aria-hidden="true">&darr;</span> Excel
          </a>
        </section>

        {error ? <p className="empty">{error}</p> : null}
        {!error && !data ? <p className="empty">Loading&hellip;</p> : null}
        {data && !items.length ? (
          <p className="empty">
            Nothing matches that. Both exchanges publish these after the close,
            so the trading day itself is quiet.
          </p>
        ) : null}

        {/* Date filter. The exchanges publish these after each close, so
            "what happened on Thursday" is a real question - and one the
            seven-day window on its own could not answer. Days come from the
            API's own index, so a day with nothing in it is never offered. */}
        {data?.days?.length ? (
          <section className="dates" aria-label="Filter bulk and block deals by day">
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
                {g.rows.length} {g.rows.length === 1 ? "deal" : "deals"}
              </span>
            </h2>

            {g.companies.map((c) => {
              const tones = new Set(
                c.rows.map((d) => (d.side === "Buy" ? "pos" : "neg"))
              );
              const tone = tones.size === 1 ? [...tones][0] : "mixed";
              const many = c.rows.length > 1;
              // Past a handful of rows the rest fold away, so the next company
              // is still on screen. <details> rather than React state: no
              // wiring, and it works before hydration.
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
                    {many ? (
                      <span className="roll">
                        {c.rows.length} investors &middot; {c.rows[0].kind} deal
                        &middot; {c.rows[0].exchange}
                      </span>
                    ) : null}
                  </div>

                  <ul className="trades">
                    {head.map(renderRow(!many))}
                  </ul>

                  {rest.length ? (
                    <details className="rest">
                      <summary>{rest.length} more in this deal</summary>
                      <ul className="trades">
                        {rest.map(renderRow(!many))}
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
          From the bulk and block deal reports NSE and BSE publish each trading
          day. Prices are the weighted average the exchange reports. Nothing
          here is advice.
        </p>
      </main>

      <style jsx global>{`
        .deals-page { padding-bottom: 72px; }
        .deals-page .head { padding-top: 26px; }
        .deals-page .head h1 {
          margin: 0 0 10px;
          font-size: 29px;
          line-height: 1.2;
          letter-spacing: -0.025em;
        }
        .deals-page .lede {
          margin: 0 0 12px;
          font-size: 16px;
          line-height: 1.6;
          color: var(--muted);
          max-width: 60ch;
        }
        .deals-page .aside {
          margin: 0 0 22px;
          font-size: 13.5px;
          line-height: 1.6;
          color: var(--dim);
          border-left: 2px solid var(--line);
          padding-left: 13px;
          max-width: 60ch;
        }

        .deals-page .tally { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 18px; }
        .deals-page .t-card {
          flex: 1 1 130px;
          background: var(--panel);
          border: 1px solid var(--line);
          border-radius: 13px;
          padding: 13px 15px;
          display: flex;
          flex-direction: column;
          gap: 1px;
        }
        .deals-page .t-card.pos { border-color: color-mix(in srgb, var(--pos) 35%, var(--line)); }
        .deals-page .t-card.neg { border-color: color-mix(in srgb, var(--neg) 35%, var(--line)); }
        .deals-page .t-n {
          font-size: 27px;
          font-weight: 680;
          letter-spacing: -0.03em;
          font-variant-numeric: tabular-nums;
        }
        .deals-page .t-card.pos .t-n { color: var(--pos); }
        .deals-page .t-card.neg .t-n { color: var(--neg); }
        .deals-page .t-l { font-size: 12.5px; color: var(--dim); }

        .deals-page .controls { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 22px; }
        .deals-page .seg {
          display: inline-flex;
          border: 1px solid var(--line);
          border-radius: 10px;
          overflow: hidden;
          background: var(--panel);
        }
        .deals-page .seg button {
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
        .deals-page .seg button:last-child { border-right: 0; }
        .deals-page .seg button:hover { background: var(--panel-2); color: var(--ink); }
        .deals-page .seg button.on { background: var(--ink); color: var(--bg); font-weight: 600; }
        .deals-page .search {
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
        .deals-page .search::placeholder { color: var(--dim); }
        .deals-page .search:focus {
          outline: none;
          border-color: color-mix(in srgb, var(--accent) 55%, var(--line));
        }
        .deals-page .dl {
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
        .deals-page .dl:hover { background: var(--panel-2); color: var(--ink); }

        .deals-page .day { margin-bottom: 26px; }
        .deals-page .day-head {
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
        .deals-page .day-head::after {
          content: "";
          flex: 1;
          height: 1px;
          background: var(--line);
        }
        .deals-page .day-n {
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

        .deals-page .card {
          background: var(--panel);
          border: 1px solid var(--line);
          border-left: 3px solid var(--line);
          border-radius: 13px;
          padding: 13px 17px 14px;
          margin-bottom: 9px;
          transition: border-color .15s ease;
        }
        .deals-page .card:hover {
          border-color: color-mix(in srgb, var(--accent) 35%, var(--line));
        }
        .deals-page .card.tone-pos { border-left-color: var(--pos); }
        .deals-page .card.tone-neg { border-left-color: var(--neg); }
        .deals-page .card.tone-mixed {
          border-left-color: color-mix(in srgb, var(--pos) 50%, var(--neg));
        }
        .deals-page .card:hover.tone-pos { border-left-color: var(--pos); }
        .deals-page .card:hover.tone-neg { border-left-color: var(--neg); }

        .deals-page .co-line {
          display: flex;
          align-items: baseline;
          gap: 8px;
          flex-wrap: wrap;
        }
        .deals-page .co { font-size: 16px; font-weight: 670; letter-spacing: -0.015em; }
        .deals-page .mcap {
          font-size: 11.5px;
          font-weight: 600;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .deals-page .mcap.lg { color: var(--accent); }
        .deals-page .mcap.md { color: var(--muted); }
        .deals-page .mcap.sm { color: var(--dim); }
        /* Both sides of one block deal in one card. Shown only when there is
           more than one investor, because otherwise it repeats the row. */
        .deals-page .roll {
          margin-left: auto;
          font-size: 12px;
          color: var(--dim);
          white-space: nowrap;
        }

        .deals-page .trades { list-style: none; margin: 0; padding: 0; }
        .deals-page .rest { margin: 0; }
        .deals-page .rest > summary {
          cursor: pointer;
          list-style: none;
          font-size: 12.5px;
          color: var(--muted);
          padding: 9px 0 1px;
        }
        .deals-page .rest > summary::-webkit-details-marker { display: none; }
        .deals-page .rest > summary::before { content: "+ "; opacity: 0.7; }
        .deals-page .rest[open] > summary::before { content: "− "; }
        .deals-page .rest > summary:hover { color: var(--ink); }

        .deals-page .t { padding-top: 9px; }
        .deals-page .t + .t { margin-top: 9px; border-top: 1px solid var(--line); }
        .deals-page .t-top {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 12px;
        }
        .deals-page .person { font-size: 14px; color: var(--ink); min-width: 0; }
        .deals-page .role { margin-left: 7px; color: var(--dim); font-size: 12px; }
        .deals-page .right {
          display: flex;
          align-items: baseline;
          gap: 9px;
          flex-shrink: 0;
        }
        .deals-page .b {
          font-size: 11.5px;
          font-weight: 650;
          padding: 3px 9px;
          border-radius: 999px;
          background: var(--panel-2);
          color: var(--muted);
          white-space: nowrap;
        }
        .deals-page .b.pos { background: var(--pos-bg); color: var(--pos); }
        .deals-page .b.neg { background: var(--neg-bg); color: var(--neg); }
        .deals-page .amt {
          font-size: 15.5px;
          font-weight: 680;
          letter-spacing: -0.02em;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
          min-width: 94px;
          text-align: right;
        }

        .deals-page .line {
          margin: 4px 0 0;
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          font-size: 12.5px;
          color: var(--dim);
          font-variant-numeric: tabular-nums;
        }
        .deals-page .qty { color: var(--muted); }

        .deals-page .dates {
          display: flex;
          gap: 7px;
          flex-wrap: wrap;
          align-items: center;
          margin-bottom: 10px;
        }
        .deals-page .dates .lbl {
          font-size: 11.5px;
          font-weight: 680;
          letter-spacing: 0.07em;
          text-transform: uppercase;
          color: var(--dim);
          margin-right: 2px;
        }
        .deals-page .chip {
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
        .deals-page .chip:hover { background: var(--panel-2); color: var(--ink); }
        .deals-page .chip.on {
          background: var(--ink);
          color: var(--bg);
          border-color: var(--ink);
          font-weight: 600;
        }
        .deals-page .chip .n {
          margin-left: 6px;
          font-size: 11px;
          opacity: 0.6;
          font-variant-numeric: tabular-nums;
        }
        .deals-page .win {
          margin-left: auto;
          border: 1px solid var(--line);
          background: var(--panel);
          color: var(--muted);
          border-radius: 10px;
          padding: 5px 10px;
          font: inherit;
          font-size: 12.5px;
        }

        .deals-page .more {
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
        .deals-page .more:hover { background: var(--panel-2); color: var(--ink); }
        .deals-page .empty { color: var(--dim); padding: 22px 0; line-height: 1.6; }
        .deals-page .verify {
          margin-top: 30px;
          color: var(--dim);
          font-size: 12.5px;
          line-height: 1.6;
          max-width: 66ch;
        }

        @media (max-width: 560px) {
          .deals-page .head h1 { font-size: 24px; }
          .deals-page .lede { font-size: 15px; }
          .deals-page .controls { gap: 10px; }
          .deals-page .seg {
            width: 100%;
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
          .deals-page .seg button {
            min-height: 44px;
            padding: 8px 6px;
            white-space: normal;
            line-height: 1.25;
          }
          .deals-page .search { min-width: 0; height: 44px; font-size: 16px; }
          .deals-page .dl { min-height: 44px; justify-content: center; }
          .deals-page .dates { gap: 6px; }
          .deals-page .chip, .deals-page .win { min-height: 40px; }
          .deals-page .win { margin-left: 0; }
          .deals-page .person, .deals-page .co { overflow-wrap: anywhere; }
          .deals-page .card { padding: 12px 14px 13px; }
          .deals-page .roll { margin-left: 0; width: 100%; white-space: normal; }
          .deals-page .t-top { flex-direction: column; gap: 5px; }
          .deals-page .right { flex-direction: row-reverse; justify-content: flex-end; }
          .deals-page .amt { min-width: 0; text-align: left; }
        }
      `}</style>
    </>
  );
}
