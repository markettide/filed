"use client";

import { useEffect, useRef, useState } from "react";

const number = (value) => Number(value || 0).toLocaleString("en-IN");

const money = (value, currency = "INR") => new Intl.NumberFormat("en-IN", {
  style: "currency", currency, maximumFractionDigits: 0,
}).format(Number(value || 0));

function when(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function clock(value) {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata",
  });
}

function duration(value) {
  const seconds = Math.max(0, Number(value || 0));
  if (seconds < 60) return seconds ? `${seconds}s` : "<1m";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function todayIndia() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function MiniTrend({ title, rows, field, format = number, color = "#4f9cff" }) {
  const values = rows.map((row) => Math.max(0, Number(row[field] || 0)));
  const max = Math.max(1, ...values);
  const width = 520;
  const height = 130;
  const points = values.map((value, index) => {
    const x = values.length > 1 ? (index / (values.length - 1)) * width : width / 2;
    const y = height - (value / max) * (height - 12) - 6;
    return `${x},${y}`;
  }).join(" ");
  const latest = values.at(-1) || 0;
  return (
    <article className="admin-chart-card">
      <div><span>{title}</span><b>{format(latest)}</b></div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title} over the last ${rows.length} days`}>
        <line x1="0" y1={height - 1} x2={width} y2={height - 1} className="admin-chart-base" />
        <polyline points={points} fill="none" stroke={color} strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <footer><span>{rows[0]?.date || ""}</span><span>{rows.at(-1)?.date || ""}</span></footer>
    </article>
  );
}

function Pager({ pagination, onPage }) {
  if (!pagination || pagination.totalPages <= 1) return null;
  return (
    <nav className="admin-pagination" aria-label="Table pages">
      <button
        onClick={() => onPage(pagination.page - 1)}
        disabled={!pagination.hasPrevious}
      >
        Previous
      </button>
      <span>
        Page {pagination.page} of {pagination.totalPages} · {number(pagination.total)} records
      </span>
      <button
        onClick={() => onPage(pagination.page + 1)}
        disabled={!pagination.hasNext}
      >
        Next 10
      </button>
    </nav>
  );
}

export default function AdminDashboard() {
  const [status, setStatus] = useState("checking");
  const [configured, setConfigured] = useState(true);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const [query, setQuery] = useState("");
  const [paidQuery, setPaidQuery] = useState("");
  const [trialQuery, setTrialQuery] = useState("");
  const [trialStatus, setTrialStatus] = useState("all");
  const [memberPage, setMemberPage] = useState(1);
  const [paidPage, setPaidPage] = useState(1);
  const [trialPage, setTrialPage] = useState(1);
  const [visitorPage, setVisitorPage] = useState(1);
  const [livePage, setLivePage] = useState(1);
  const [selectedDate, setSelectedDate] = useState(todayIndia);
  const requestSequence = useRef(0);

  async function load(date = selectedDate, silent = false, overrides = {}) {
    const sequence = ++requestSequence.current;
    if (!silent) setStatus("loading");
    const params = new URLSearchParams({
      date,
      memberPage: String(overrides.memberPage ?? memberPage),
      paidPage: String(overrides.paidPage ?? paidPage),
      trialPage: String(overrides.trialPage ?? trialPage),
      visitorPage: String(overrides.visitorPage ?? visitorPage),
      livePage: String(overrides.livePage ?? livePage),
    });
    const memberQuery = overrides.memberQuery ?? query;
    if (memberQuery.trim()) params.set("memberQuery", memberQuery.trim());
    const nextPaidQuery = overrides.paidQuery ?? paidQuery;
    if (nextPaidQuery.trim()) params.set("paidQuery", nextPaidQuery.trim());
    const nextTrialQuery = overrides.trialQuery ?? trialQuery;
    if (nextTrialQuery.trim()) params.set("trialQuery", nextTrialQuery.trim());
    params.set("trialStatus", overrides.trialStatus ?? trialStatus);
    const response = await fetch(`/api/admin/stats?${params}`, { cache: "no-store" });
    if (sequence !== requestSequence.current) return;
    if (response.status === 401) {
      setStatus("locked");
      return;
    }
    const body = await response.json();
    if (!response.ok) {
      setError(body.error || "Could not load admin data.");
      setStatus("error");
      return;
    }
    setData(body);
    setStatus("ready");
  }

  useEffect(() => {
    fetch("/api/admin/auth", { cache: "no-store" })
      .then((response) => response.json())
      .then((body) => {
        setConfigured(Boolean(body.configured));
        if (body.authenticated) load();
        else setStatus("locked");
      })
      .catch(() => {
        setError("Could not reach the admin service.");
        setStatus("error");
      });
  }, []);

  useEffect(() => {
    if (status !== "ready") return undefined;
    const timer = window.setInterval(() => load(selectedDate, true), 30000);
    return () => window.clearInterval(timer);
  }, [status, selectedDate, memberPage, paidPage, trialPage, visitorPage, livePage, query, paidQuery, trialQuery, trialStatus]);

  useEffect(() => {
    if (status !== "ready") return undefined;
    const timer = window.setTimeout(() => {
      setMemberPage(1);
      load(selectedDate, true, { memberPage: 1, memberQuery: query });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (status !== "ready") return undefined;
    const timer = window.setTimeout(() => {
      setPaidPage(1);
      load(selectedDate, true, { paidPage: 1, paidQuery });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [paidQuery]);

  useEffect(() => {
    if (status !== "ready") return undefined;
    const timer = window.setTimeout(() => {
      setTrialPage(1);
      load(selectedDate, true, {
        trialPage: 1,
        trialQuery,
        trialStatus,
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [trialQuery, trialStatus]);

  async function login(event) {
    event.preventDefault();
    setError("");
    setStatus("signing-in");
    const response = await fetch("/api/admin/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error || "Could not sign in.");
      setStatus("locked");
      return;
    }
    setPassword("");
    await load();
  }

  async function logout() {
    await fetch("/api/admin/auth", { method: "DELETE" });
    setData(null);
    setStatus("locked");
  }

  const shown = data?.members || [];
  const paidShown = data?.paidMembers || [];
  const trialShown = data?.trialUsers || [];

  if (status !== "ready") {
    return (
      <main className="admin-lock">
        <section className="admin-login">
          <div className="admin-brand"><span className="dot" /> Market Tide</div>
          <p className="admin-kicker">Private operations</p>
          <h1>Admin dashboard</h1>
          {status === "checking" || status === "loading" ? (
            <p className="admin-muted">Checking secure access…</p>
          ) : !configured ? (
            <p className="admin-alert">Admin access is disabled. Add ADMIN_PASSWORD in Vercel.</p>
          ) : (
            <form onSubmit={login}>
              <label htmlFor="admin-password">Password</label>
              <input
                id="admin-password"
                type="password"
                autoFocus
                required
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button disabled={status === "signing-in"}>
                {status === "signing-in" ? "Opening…" : "Open dashboard"}
              </button>
            </form>
          )}
          {error && <p className="admin-alert">{error}</p>}
          <a className="admin-home" href="/">Return to Market Tide</a>
        </section>
      </main>
    );
  }

  const cards = [
    ["Unique members", data.totals.members],
    ["Verified logins", data.totals.verified],
    ["Newsletter", data.totals.subscribed],
    ["Phone numbers", data.totals.withPhone],
    ["Paid members", data.totals.paid],
    ["Trials active", data.totals.activeTrials],
    ["Expired · unpaid", data.totals.expiredUnpaidTrials],
    ["Trial conversions", data.totals.convertedTrials],
    ["Reached trial gate", data.totals.trialGateUsers],
    ["Clicked trial CTA", data.totals.trialCtaUsers],
    ["Unverified", data.totals.members - data.totals.verified],
    ["Reading now", data.traffic.live],
    ["Unique visitors", data.traffic.unique],
    ["Total visits", data.traffic.total],
    ["Visitors on date", data.engagement.totals.visitors],
    ["Sessions on date", data.engagement.totals.sessions],
    ["Page views on date", data.engagement.totals.pageViews],
    ["Time on site", duration(data.engagement.totals.durationSeconds)],
  ];

  return (
    <main className="admin-page">
      <header className="admin-top">
        <div>
          <div className="admin-brand"><span className="dot" /> Market Tide</div>
          <h1>Operations dashboard</h1>
          <p>Members, acquisition sources and website traffic in one place.</p>
        </div>
        <div className="admin-top-actions">
          <a className="admin-export" href={`/api/admin/export?date=${encodeURIComponent(selectedDate)}`}>Download Excel</a>
          <button onClick={() => load(selectedDate)}>Refresh</button>
          <button className="admin-quiet" onClick={logout}>Log out</button>
        </div>
      </header>

      <section className="admin-cards">
        {cards.map(([label, value]) => (
          <article key={label}><span>{label}</span><b>{typeof value === "number" ? number(value) : value}</b></article>
        ))}
      </section>

      <section className="admin-panel admin-live-panel">
        <div className="admin-panel-head">
          <div><p className="admin-kicker">Live</p><h2>Reading now</h2></div>
          <span>Active tab seen in the last 5 minutes · refreshes every 30 seconds</span>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table admin-live-table">
            <thead><tr><th>Reader</th><th>Email</th><th>Phone</th><th>Page</th><th>Reading for</th><th>Started</th><th>Last heartbeat</th></tr></thead>
            <tbody>
              {data.liveReaders.map((reader) => (
                <tr key={reader.key}>
                  <td><b>{reader.email || `Anonymous · ${reader.visitorId.slice(0, 8)}`}</b></td>
                  <td>{reader.email || "—"}</td>
                  <td>{reader.phone || "—"}</td>
                  <td><span className="admin-page-pill">{reader.currentPath}</span></td>
                  <td>{duration(reader.readingSeconds)}</td>
                  <td>{clock(reader.startedAt)}</td>
                  <td>{clock(reader.lastSeenAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.liveReaders.length && <p className="admin-empty">Nobody is actively reading right now.</p>}
        </div>
        <Pager
          pagination={data.livePagination}
          onPage={(page) => {
            setLivePage(page);
            load(selectedDate, true, { livePage: page });
          }}
        />
        <p className="admin-live-note">Anonymous means the browser has not signed in, the login cookie expired, or private browsing cleared it. Market Tide cannot safely infer that visitor’s email or phone.</p>
      </section>

      <section className="admin-panel">
        <div className="admin-panel-head">
          <div><p className="admin-kicker">Trends</p><h2>Day-wise traffic</h2></div>
          <span>Last 30 days · Asia/Kolkata dates</span>
        </div>
        <div className="admin-chart-grid">
          <MiniTrend title="Visitors" rows={data.trend} field="visitors" />
          <MiniTrend title="Sessions" rows={data.trend} field="sessions" color="#7c5cff" />
          <MiniTrend title="Page views" rows={data.trend} field="pageViews" color="#17b26a" />
          <MiniTrend title="Reading time" rows={data.trend.map((row) => ({ ...row, minutes: row.durationSeconds / 60 }))} field="minutes" format={(value) => duration(value * 60)} color="#f59e0b" />
        </div>
      </section>

      <section className="admin-panel">
        <div className="admin-panel-head admin-engagement-head">
          <div>
            <p className="admin-kicker">Engagement</p>
            <h2>Daily visitor sessions</h2>
          </div>
          <label className="admin-date">
            <span>Choose date</span>
            <input
              type="date"
              value={selectedDate}
              max={todayIndia()}
              onChange={(event) => {
                const next = event.target.value;
                setSelectedDate(next);
                setVisitorPage(1);
                if (next) load(next, false, { visitorPage: 1 });
              }}
            />
          </label>
        </div>
        <p className="admin-engagement-summary">
          {number(data.engagement.totals.identifiedVisitors)} signed-in visitors · average session {duration(data.engagement.totals.averageSessionSeconds)}
        </p>
        <div className="admin-top-pages">
          {data.engagement.topPages.map((page) => (
            <span key={page.path}><b>{page.path}</b> {number(page.sessions)} sessions</span>
          ))}
        </div>
        <div className="admin-page-bars">
          {data.engagement.topPages.map((page) => {
            const max = Math.max(1, ...data.engagement.topPages.map((item) => item.sessions));
            return (
              <div key={page.path}>
                <span>{page.path}</span>
                <i><b style={{ width: `${(page.sessions / max) * 100}%` }} /></i>
                <strong>{number(page.sessions)}</strong>
              </div>
            );
          })}
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table admin-engagement-table">
            <thead>
              <tr><th>Visitor</th><th>Phone</th><th>Visits</th><th>Each session</th><th>Page views</th><th>Whole-day time</th><th>Average</th><th>Longest</th><th>First / last seen</th><th>Pages</th></tr>
            </thead>
            <tbody>
              {data.engagement.visitors.map((visitor) => (
                <tr key={visitor.key}>
                  <td><b>{visitor.email || `Anonymous · ${visitor.visitorId.slice(0, 8)}`}</b></td>
                  <td>{visitor.phone || "—"}</td>
                  <td>{number(visitor.sessions)}</td>
                  <td>
                    <div className="admin-session-times">
                      {visitor.sessionDetails.map((session, index) => (
                        <span key={`${session.startedAt}:${index}`}>{index + 1}. {duration(session.durationSeconds)}</span>
                      ))}
                    </div>
                  </td>
                  <td>{number(visitor.pageViews)}</td>
                  <td>{duration(visitor.durationSeconds)}</td>
                  <td>{duration(visitor.averageSessionSeconds)}</td>
                  <td>{duration(visitor.longestSessionSeconds)}</td>
                  <td>{clock(visitor.firstSeenAt)} / {clock(visitor.lastSeenAt)}</td>
                  <td><div className="admin-tags">{visitor.pages.map((page) => <span key={page}>{page}</span>)}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.engagement.visitors.length && (
            <p className="admin-empty">No tracked sessions for this date.</p>
          )}
        </div>
        <Pager
          pagination={data.engagement.pagination}
          onPage={(page) => {
            setVisitorPage(page);
            load(selectedDate, true, { visitorPage: page });
          }}
        />
      </section>

      <section className="admin-panel">
        <div className="admin-panel-head">
          <div><p className="admin-kicker">Acquisition</p><h2>Where members came from</h2></div>
          <span>One member can belong to more than one source.</span>
        </div>
        <div className="admin-sources">
          {Object.entries(data.sourceCounts).sort((a, b) => b[1] - a[1]).map(([source, count]) => (
            <div key={source}><span>{source}</span><b>{number(count)}</b></div>
          ))}
        </div>
      </section>

      <section className="admin-panel">
        <div className="admin-panel-head admin-members-head">
          <div>
            <p className="admin-kicker">Trial follow-up</p>
            <h2>Seven-day free trials</h2>
          </div>
          <div className="admin-filter-controls">
            <select
              aria-label="Filter trials by status"
              value={trialStatus}
              onChange={(event) => setTrialStatus(event.target.value)}
            >
              <option value="all">All trial users</option>
              <option value="not-started">Interested · not started</option>
              <option value="active">Active trials</option>
              <option value="expired-unpaid">Expired · did not buy</option>
              <option value="converted">Converted to paid</option>
            </select>
            <input
              type="search"
              placeholder="Search trial email or phone…"
              value={trialQuery}
              onChange={(event) => setTrialQuery(event.target.value)}
            />
          </div>
        </div>
        <p className="admin-engagement-summary">
          Use “Expired · did not buy” to find members who completed the trial without purchasing Premium.
        </p>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr><th>Member</th><th>Phone</th><th>Trial started</th><th>Trial ends</th><th>Time remaining</th><th>Interest</th><th>Status</th></tr>
            </thead>
            <tbody>
              {trialShown.map((member) => (
                <tr key={member.email} className={member.targetable ? "admin-target-row" : undefined}>
                  <td><b>{member.email}</b></td>
                  <td>{member.phone || "—"}</td>
                  <td>{when(member.startedAt)}</td>
                  <td>{when(member.endsAt)}</td>
                  <td>
                    {member.status === "not-started"
                      ? "Trial not started"
                      : member.status === "active"
                      ? `${member.daysLeft} ${member.daysLeft === 1 ? "day" : "days"} left`
                      : member.status === "expired-unpaid"
                        ? `Ended ${member.daysSinceEnd} ${member.daysSinceEnd === 1 ? "day" : "days"} ago`
                        : "Paid plan active/history"}
                  </td>
                  <td>
                    <div className="admin-session-times">
                      <span>{number(member.gateViews)} gate views</span>
                      <span>{number(member.ctaClicks)} CTA clicks</span>
                      {member.lastInterestPath && <span>{member.lastInterestPath}</span>}
                    </div>
                  </td>
                  <td>
                    <div className="admin-tags">
                      <span className={`admin-trial-${member.status}`}>
                        {member.status === "not-started" ? "Invite to trial" : member.status === "active" ? "Trial active" : member.status === "converted" ? "Converted" : "Follow up"}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!trialShown.length && <p className="admin-empty">No trial users match this filter.</p>}
        </div>
        <Pager
          pagination={data.trialPagination}
          onPage={(page) => {
            setTrialPage(page);
            load(selectedDate, true, { trialPage: page });
          }}
        />
      </section>

      <section className="admin-panel">
        <div className="admin-panel-head admin-members-head">
          <div>
            <p className="admin-kicker">Revenue</p>
            <h2>Paid members</h2>
          </div>
          <input
            type="search"
            placeholder="Search paid email, phone or order…"
            value={paidQuery}
            onChange={(event) => setPaidQuery(event.target.value)}
          />
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr><th>Member</th><th>Phone</th><th>Amount</th><th>Paid on</th><th>Order ID</th><th>Access active until</th><th>Status</th></tr>
            </thead>
            <tbody>
              {paidShown.map((member) => (
                <tr key={member.orderId || member.email}>
                  <td><b>{member.email}</b></td>
                  <td>{member.phone || "—"}</td>
                  <td>{money(member.amount, member.currency)}</td>
                  <td>{when(member.paidAt)}</td>
                  <td>{member.orderId || "—"}</td>
                  <td>{when(member.endsAt)}</td>
                  <td><div className="admin-tags"><span>Active paid</span></div></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!paidShown.length && <p className="admin-empty">No active paid members match that search.</p>}
        </div>
        <Pager
          pagination={data.paidPagination}
          onPage={(page) => {
            setPaidPage(page);
            load(selectedDate, true, { paidPage: page });
          }}
        />
      </section>

      <section className="admin-panel">
        <div className="admin-panel-head admin-members-head">
          <div><p className="admin-kicker">Directory</p><h2>All members</h2></div>
          <input
            type="search"
            placeholder="Search email, phone or source…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Member</th><th>Phone</th><th>Sources</th><th>Status</th><th>Joined</th><th>Last activity</th></tr></thead>
            <tbody>
              {shown.map((member) => (
                <tr key={member.email}>
                  <td><b>{member.email}</b></td>
                  <td>{member.phone || "—"}</td>
                  <td><div className="admin-tags">{member.sources.map((source) => <span key={source}>{source}</span>)}</div></td>
                  <td>{member.verified ? "Verified" : "Subscriber"}</td>
                  <td>{when(member.createdAt)}</td>
                  <td>{when(member.lastActivityAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!shown.length && <p className="admin-empty">No members match that search.</p>}
        </div>
        <Pager
          pagination={data.memberPagination}
          onPage={(page) => {
            setMemberPage(page);
            load(selectedDate, true, { memberPage: page });
          }}
        />
      </section>
      <p className="admin-updated">Updated {when(data.generatedAt)} · Sensitive member data · Do not share this page.</p>
    </main>
  );
}
