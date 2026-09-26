"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Nav from "../Nav";
import AuthGate from "../AuthGate";
import FilingCard from "../FilingCard";

/**
 * The reader's own companies, and what they have filed.
 *
 * Two halves, and the split matters commercially:
 *
 *   the LIST     free, five stocks; Premium, fifty
 *   the ALERTS   Premium only
 *
 * A free reader can therefore build a watchlist and read it here whenever
 * they like. What they cannot do is be told the moment something lands, and
 * that is the thing worth paying for - so the upgrade prompt appears next to
 * the alert switch, where the reader is already thinking about it, rather
 * than across the top of a page they can use.
 *
 * The filings come from the dashboard's own endpoint with the scope already
 * applied, then are filtered here against the watchlist. Seven days is a few
 * thousand rows at most, which is nothing to filter in a browser, and it
 * means the watchlist cannot fall out of step with the dashboard - the same
 * rows, the same cards, the same summaries.
 */

// Ported from lib/companies.js, and it has to stay identical to it - the two
// sides compare the strings this produces. See the note there about why
// "india" is kept rather than deleted.
function matchKey(name) {
  let n = String(name || "").toLowerCase();
  n = n.replace(/\(\s*i\s*\)/g, " india ");
  n = n.replace(/\(\s*india\s*\)/g, " india ");
  n = n.replace(/\bindian\b/g, " india ");
  n = n.replace(/\([^)]{1,7}\)/g, " ");
  n = n.replace(
    /\b(limited|ltd|private|pvt|the|and|company|co|corporation|corp|inc)\b/g,
    " "
  );
  return n.replace(/[^a-z0-9]/g, "");
}

function crLabel(cr) {
  if (!cr) return "";
  if (cr >= 100000) return `Rs ${(cr / 100000).toFixed(2)} lakh cr`;
  if (cr >= 1000) return `Rs ${Math.round(cr).toLocaleString("en-IN")} cr`;
  return `Rs ${cr.toFixed(0)} cr`;
}

export default function Watchlist() {
  const [portfolio, setPortfolio] = useState(null);
  const [filings, setFilings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [feedLocked, setFeedLocked] = useState(false);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const searchSeq = useRef(0);

  const loadPortfolio = useCallback(async () => {
    const res = await fetch("/api/portfolio", { cache: "no-store" });
    if (res.status === 401) {
      setPortfolio({ signedOut: true });
      return null;
    }
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Could not load your watchlist.");
      return null;
    }
    setPortfolio(data);
    return data;
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const [p, f] = await Promise.all([
          loadPortfolio(),
          // The filings endpoint is Premium, the same as the dashboard. A
          // free reader gets a 403 here, and that is not a failure to hide -
          // it is the answer, and the page says so below rather than
          // showing an empty feed and letting them wonder.
          fetch("/api/announcements?days=7", { cache: "no-store" })
            .then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json() }))
            .catch(() => ({ ok: false, status: 0, body: {} })),
        ]);
        if (!alive) return;
        if (f.ok) setFilings(f.body.items || []);
        else if (f.status === 403) setFeedLocked(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [loadPortfolio]);

  // Search. Every keystroke cancels the answer to the last one - without the
  // sequence check a slow reply for "rel" can land after a fast one for
  // "reliance" and replace the right list with a stale one.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/companies?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        if (seq === searchSeq.current) setResults(data.companies || []);
      } catch {
        if (seq === searchSeq.current) setResults([]);
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [query]);

  const held = portfolio?.stocks || [];
  const heldIsins = useMemo(() => new Set(held.map((s) => s.isin)), [held]);
  const heldKeys = useMemo(() => new Set(held.map((s) => s.key)), [held]);

  const mine = useMemo(
    () => filings.filter((f) => heldKeys.has(matchKey(f.company))),
    [filings, heldKeys]
  );

  async function add(company) {
    setNotice("");
    const res = await fetch("/api/portfolio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isin: company.isin }),
    });
    const data = await res.json();
    if (!res.ok) {
      setNotice(data.error || "Could not add that stock.");
      return;
    }
    setPortfolio((p) => ({ ...p, stocks: data.stocks }));
    setQuery("");
    setResults([]);
  }

  async function remove(isin) {
    setNotice("");
    const res = await fetch(`/api/portfolio?isin=${encodeURIComponent(isin)}`, {
      method: "DELETE",
    });
    const data = await res.json();
    if (res.ok) setPortfolio((p) => ({ ...p, stocks: data.stocks }));
  }

  async function connectTelegram() {
    setNotice("");
    const res = await fetch("/api/telegram/link");
    const data = await res.json();
    if (!res.ok) {
      setNotice(data.error || "Could not start the Telegram link.");
      return;
    }
    window.open(data.url, "_blank", "noopener");
    setNotice(
      "Telegram is opening. Tap Start in the chat, then come back and refresh."
    );
  }

  const limit = portfolio?.limit ?? 5;
  const premium = Boolean(portfolio?.premium);
  const full = held.length >= limit;

  return (
    <>
      <Nav />
      <AuthGate>
        <div className="dash-shell">
          <header className="dash-top">
            <h1>Your watchlist</h1>
            <p className="wl-blurb">
              Follow companies and see only their filings — the summary, the
              numbers and the original PDF, the same as the dashboard.
            </p>
          </header>

        <section className="wl-panel">
          <div className="wl-panel-head">
            <h2>
              Companies{" "}
              <span className="wl-count">
                {held.length} of {limit}
              </span>
            </h2>
            {!premium && (
              <a className="wl-upgrade" href="/pricing">
                Premium holds 50 →
              </a>
            )}
          </div>

          <div className="wl-search">
            <input
              type="search"
              value={query}
              placeholder="Search a company — try “reliance” or “INFY”"
              onChange={(e) => setQuery(e.target.value)}
              disabled={full}
              aria-label="Search for a company to follow"
            />
            {full && (
              <p className="wl-note">
                {premium
                  ? `That is all ${limit}. Remove one to follow another.`
                  : `The free plan follows ${limit} companies. `}
                {!premium && <a href="/pricing">Premium follows 50.</a>}
              </p>
            )}
            {searching && <p className="wl-note">Searching…</p>}

            {results.length > 0 && !full && (
              <ul className="wl-results">
                {results.map((c) => (
                  <li key={c.isin}>
                    <button
                      type="button"
                      onClick={() => add(c)}
                      disabled={heldIsins.has(c.isin)}
                    >
                      <span className="wl-r-name">{c.name}</span>
                      <span className="wl-r-meta">
                        {c.ticker}
                        {c.board === "SME" && <em className="wl-sme">SME</em>}
                        {crLabel(c.cr) && <span>· {crLabel(c.cr)}</span>}
                      </span>
                      <span className="wl-r-add">
                        {heldIsins.has(c.isin) ? "Following" : "Follow"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {notice && <p className="wl-notice">{notice}</p>}

          {held.length > 0 && (
            <ul className="wl-held">
              {held.map((s) => (
                <li key={s.isin}>
                  <span className="wl-h-name">{s.name}</span>
                  <span className="wl-h-ticker">{s.ticker}</span>
                  <button
                    type="button"
                    onClick={() => remove(s.isin)}
                    aria-label={`Stop following ${s.name}`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          {portfolio?.parked > 0 && (
            <p className="wl-note">
              {portfolio.parked} more {portfolio.parked === 1 ? "company is" : "companies are"}{" "}
              saved but not being followed on the free plan.{" "}
              <a href="/pricing">Premium brings them back.</a>
            </p>
          )}
        </section>

        <section className="wl-panel">
          <div className="wl-panel-head">
            <h2>Telegram alerts</h2>
            {!premium && <span className="wl-badge">Premium</span>}
          </div>

          {!premium ? (
            <p className="wl-note">
              Premium sends every filing by these companies to Telegram as it
              lands — the summary, the key numbers and the PDF, within minutes.{" "}
              <a href="/pricing">See Premium →</a>
            </p>
          ) : portfolio?.telegram?.linked ? (
            <p className="wl-note wl-ok">
              Connected
              {portfolio.telegram.username ? ` as @${portfolio.telegram.username}` : ""}.
              Alerts are sent as filings arrive.
            </p>
          ) : (
            <>
              <p className="wl-note">
                Connect Telegram and we will send each filing as it lands.
              </p>
              <button type="button" className="wl-connect" onClick={connectTelegram}>
                Connect Telegram
              </button>
            </>
          )}
        </section>

        <section className="feed">
          <h2 className="wl-feed-head">
            Their filings
            <span className="meta"> · last 7 days</span>
          </h2>

          {loading && <p className="wl-note">Loading…</p>}
          {error && <p className="wl-notice">{error}</p>}

          {!loading && feedLocked && (
            <div className="wl-empty">
              <p>
                <b>Filing summaries are part of Premium.</b>
              </p>
              <p>
                Your watchlist is saved either way — Premium shows what these
                companies have filed, and sends each one to Telegram as it
                lands.
              </p>
              <p>
                <a href="/pricing">See Premium →</a>
              </p>
            </div>
          )}

          {!loading && !feedLocked && !held.length && (
            <p className="wl-empty">
              Add a company above and its filings will appear here.
            </p>
          )}

          {!loading && !feedLocked && held.length > 0 && !mine.length && (
            <p className="wl-empty">
              Nothing filed by these companies in the last seven days.
            </p>
          )}

          {mine.map((it) => (
            <FilingCard it={it} key={it.id} />
          ))}
          </section>
        </div>
      </AuthGate>
    </>
  );
}
