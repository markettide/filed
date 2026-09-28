"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Nav from "../Nav";
import AuthGate from "../AuthGate";
import FilingCard from "../FilingCard";

function TelegramLogin({ bot, onConnected, onError }) {
  const host = useRef(null);

  useEffect(() => {
    if (!bot || !host.current) return;
    const callbackName = "__marketTideTelegramConnected";
    const target = host.current;

    window[callbackName] = async (telegramUser) => {
      try {
        const response = await fetch("/api/telegram/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(telegramUser),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not connect Telegram.");
        onConnected(data);
      } catch (error) {
        onError(error.message || "Could not connect Telegram.");
      }
    };

    target.replaceChildren();
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", bot);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "8");
    script.setAttribute("data-request-access", "write");
    script.setAttribute("data-onauth", `window.${callbackName}(user)`);
    target.appendChild(script);

    return () => {
      delete window[callbackName];
      target.replaceChildren();
    };
  }, [bot, onConnected, onError]);

  return <div className="wl-telegram-login" ref={host} />;
}

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
  const [watchlist, setWatchlist] = useState(null);
  const [filings, setFilings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [feedLocked, setFeedLocked] = useState(false);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const searchSeq = useRef(0);

  const loadWatchlist = useCallback(async () => {
    const res = await fetch("/api/watchlist", { cache: "no-store" });
    if (res.status === 401) {
      setWatchlist({ signedOut: true });
      return null;
    }
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Could not load your watchlist.");
      return null;
    }
    setWatchlist(data);
    return data;
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const [p, f] = await Promise.all([
          loadWatchlist(),
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
  }, [loadWatchlist]);

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

  const held = watchlist?.stocks || [];
  const heldIsins = useMemo(() => new Set(held.map((s) => s.isin)), [held]);
  const heldKeys = useMemo(() => new Set(held.map((s) => s.key)), [held]);

  const mine = useMemo(
    () => filings.filter((f) => heldKeys.has(matchKey(f.company))),
    [filings, heldKeys]
  );

  async function add(company) {
    setNotice("");
    const res = await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isin: company.isin }),
    });
    const data = await res.json();
    if (!res.ok) {
      setNotice(data.error || "Could not add that stock.");
      return;
    }
    setWatchlist((p) => ({ ...p, stocks: data.stocks }));
    setQuery("");
    setResults([]);
  }

  async function remove(isin) {
    setNotice("");
    const res = await fetch(`/api/watchlist?isin=${encodeURIComponent(isin)}`, {
      method: "DELETE",
    });
    const data = await res.json();
    if (res.ok) setWatchlist((p) => ({ ...p, stocks: data.stocks }));
  }

  const telegramConnected = useCallback(async (data) => {
    await loadWatchlist();
    setNotice(
      `Telegram connected${data.username ? ` as @${data.username}` : ""}. A confirmation message was sent.`
    );
  }, [loadWatchlist]);

  const telegramError = useCallback((message) => {
    setNotice(message);
  }, []);

  async function disconnectTelegram() {
    setNotice("");
    const res = await fetch("/api/telegram/link", { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      setNotice(data.error || "Could not disconnect Telegram.");
      return;
    }
    setWatchlist((current) => ({
      ...current,
      telegram: { linked: false },
      alertsEnabled: false,
    }));
    setNotice("Telegram disconnected.");
  }

  const limit = watchlist?.limit ?? 5;
  const premium = Boolean(watchlist?.premium);
  const full = held.length >= limit;
  const telegramLinked = Boolean(watchlist?.telegram?.linked);
  const noticePositive =
    notice.startsWith("Telegram connected") || notice === "Telegram disconnected.";

  return (
    <>
      <Nav />
      <AuthGate>
        <div className="dash-shell">
          <header className="dash-top wl-hero">
            <div className="wl-eyebrow">Your personal filing radar</div>
            <h1>Watch the companies that matter to you</h1>
            <p className="wl-blurb">
              Keep one focused feed for company filings, plain-English
              summaries and instant Telegram alerts.
            </p>
            <div className="wl-overview" aria-label="Watchlist overview">
              <div>
                <span className="wl-overview-icon wl-overview-icon--blue">◎</span>
                <p><b>{held.length}</b><span>Companies followed</span></p>
              </div>
              <div>
                <span className="wl-overview-icon wl-overview-icon--violet">↗</span>
                <p><b>{mine.length}</b><span>Updates in 7 days</span></p>
              </div>
              <div>
                <span className={`wl-overview-icon ${telegramLinked ? "wl-overview-icon--green" : ""}`}>✦</span>
                <p>
                  <b>{telegramLinked ? "On" : "Off"}</b>
                  <span>Telegram alerts</span>
                </p>
              </div>
            </div>
          </header>

        {notice && (
          <p className={`wl-notice ${noticePositive ? "wl-notice--success" : ""}`}>
            <span aria-hidden="true">{noticePositive ? "✓" : "!"}</span>
            {notice}
          </p>
        )}

        <div className="wl-setup-grid">
        <section className="wl-panel wl-companies-panel">
          <div className="wl-panel-head">
            <div>
              <span className="wl-section-kicker">Watchlist</span>
              <h2>Companies</h2>
            </div>
            <span className="wl-count">{held.length} / {limit}</span>
            {!premium && (
              <a className="wl-upgrade" href="/pricing">
                Start trial or Premium · 50 →
              </a>
            )}
          </div>

          <div className="wl-capacity" aria-label={`${held.length} of ${limit} companies followed`}>
            <span style={{ width: `${Math.min(100, (held.length / limit) * 100)}%` }} />
          </div>

          <div className="wl-search">
            <span className="wl-search-icon" aria-hidden="true">⌕</span>
            <input
              type="search"
              value={query}
              placeholder="Search by company or ticker"
              onChange={(e) => setQuery(e.target.value)}
              disabled={full}
              aria-label="Search for a company to follow"
            />
            {full && (
              <p className="wl-note">
                {premium
                  ? `That is all ${limit}. Remove one to follow another.`
                  : `The free plan follows ${limit} companies. `}
                {!premium && <a href="/pricing">Start a 7-day trial or buy Premium to follow 50.</a>}
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

          {held.length > 0 && (
            <ul className="wl-held">
              {held.map((s) => (
                <li key={s.isin}>
                  <span className="wl-company-mark" aria-hidden="true">
                    {(s.ticker || s.name || "?").slice(0, 1)}
                  </span>
                  <span className="wl-company-copy">
                    <span className="wl-h-name">{s.name}</span>
                    <span className="wl-h-ticker">{s.ticker} · Following</span>
                  </span>
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

        </section>

        <section className={`wl-panel wl-alert-panel ${telegramLinked ? "is-connected" : ""}`}>
          <div className="wl-panel-head">
            <div>
              <span className="wl-section-kicker">Delivery</span>
              <h2>Telegram alerts</h2>
            </div>
            {!premium && <span className="wl-badge">Premium</span>}
          </div>

          {!premium ? (
            <p className="wl-note">
              Telegram alerts require an active 7-day trial or paid plan. If
              access expires, Telegram is disconnected automatically. {" "}
              <a href="/pricing">Start trial or see Premium →</a>
            </p>
          ) : !watchlist?.telegramAvailable ? (
            <p className="wl-note">
              Telegram setup is not active on this deployment yet.
            </p>
          ) : watchlist?.telegram?.linked ? (
            <div className="wl-connected-card">
              <div className="wl-connected-icon" aria-hidden="true">✓</div>
              <div className="wl-connected-copy">
                <strong>Alerts are active</strong>
                <span>
                  {watchlist.telegram.username
                    ? `Connected as @${watchlist.telegram.username}`
                    : "Telegram connected"}
                </span>
                <small>New filings from followed companies will arrive automatically.</small>
              </div>
              <button
                type="button"
                className="wl-disconnect"
                onClick={disconnectTelegram}
              >
                Disconnect
              </button>
            </div>
          ) : (
            <>
              <div className="wl-telegram-illustration" aria-hidden="true">➤</div>
              <p className="wl-note">
                Approve once with Telegram and we will send each new filing as
                it lands. You do not need to paste a command or press Start.
              </p>
              <TelegramLogin
                bot={watchlist?.telegramBot}
                onConnected={telegramConnected}
                onError={telegramError}
              />
            </>
          )}
        </section>
        </div>

        <section className="feed">
          <div className="wl-feed-head">
            <div>
              <span className="wl-section-kicker">Latest activity</span>
              <h2>Their filings <span>{mine.length}</span></h2>
              <p>Important filings from your companies during the last seven days.</p>
            </div>
          </div>

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
            <div className="wl-empty">
              <span aria-hidden="true">＋</span>
              <b>Build your watchlist</b>
              <p>Add a company above and its latest filings will appear here.</p>
            </div>
          )}

          {!loading && !feedLocked && held.length > 0 && !mine.length && (
            <div className="wl-empty">
              <span aria-hidden="true">✓</span>
              <b>You’re all caught up</b>
              <p>No new filings from these companies in the last seven days.</p>
            </div>
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
