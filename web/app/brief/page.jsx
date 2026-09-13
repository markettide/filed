"use client";

import { useEffect, useRef, useState } from "react";
import Nav from "../Nav";
import MkFooter from "../MkFooter";
import { SITE } from "../site";
import { useSiteAuth } from "../SiteAuth";

/**
 * One page for the brief: read it, download it, subscribe to it.
 *
 * It used to be two - /brief to read and /subscribe to sign up - which meant
 * someone who came to read had to find a second page to subscribe, and someone
 * who came to subscribe never saw the thing they were subscribing to. /subscribe
 * now redirects here.
 *
 * Only the latest issue is offered. A daily brief is a thing you read this
 * morning, not an archive you browse; yesterday's numbers are on the dashboard,
 * which is where anything older belongs.
 */
export default function Brief() {
  const { ready, user, openAuth } = useSiteAuth();
  const [latest, setLatest] = useState(null);
  const [loading, setLoading] = useState(true);

  const [email, setEmail] = useState("");
  const emailPrefilled = useRef(false);
  const [company, setCompany] = useState("");   // honeypot
  const [state, setState] = useState("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    let dead = false;
    fetch("/api/brief/latest")
      .then((r) => r.json())
      .then((d) => !dead && setLatest(d.day || null))
      .catch(() => {})
      .finally(() => !dead && setLoading(false));
    return () => { dead = true; };
  }, []);

  useEffect(() => {
    // Prefill once when the signed-in user becomes available. After that the
    // field belongs to the visitor, so clearing it must not restore their
    // account email on the next render.
    if (user?.id && !emailPrefilled.current) {
      emailPrefilled.current = true;
      setEmail(user.id);
    }
  }, [user]);

  async function subscribe(address) {
    if (state === "sending") return;
    setState("sending");
    setError("");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: address, company, source: "brief" }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error || "Please try again.");
        setState("idle");
        return;
      }
      setState("done");
    } catch {
      setError("Couldn't reach the server. Please try again.");
      setState("idle");
    }
  }

  function submit(e) {
    e.preventDefault();
    if (!ready) return;
    if (!user) {
      openAuth({
        clear: true,
        email,
        onAuthenticated: (signedInUser) => {
          const address = email || signedInUser?.id || "";
          setEmail(address);
          subscribe(address);
        },
      });
      return;
    }
    subscribe(email || user?.id || "");
  }

  const pretty = (iso) =>
    new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", {
      day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
    });

  return (
    <>
      <Nav />
        <main className="mk">
        <section className="brief-hero">
          <p className="mk-kicker">Free daily newsletter</p>
          <h1 className="mk-h1">The morning brief</h1>
          <p className="mk-sub">
            Every morning at 8:00 we send you the{" "}
            <strong>50 filings that actually matter</strong> from yesterday and
            overnight — what happened, the key numbers, and why it matters. One
            PDF. Free.
          </p>

          {/* ---- today's issue ---- */}
          {loading ? (
            <div className="brief-latest brief-latest--wait">
              <div>
                <span className="brief-kicker">Today&apos;s issue</span>
                <span className="brief-loading-line">Checking the latest issue&hellip;</span>
              </div>
            </div>
          ) : latest ? (
            <div className="brief-latest">
              <div>
                <span className="brief-kicker">Today&apos;s issue</span>
                <b>{pretty(latest)}</b>
              </div>
              <div className="brief-actions">
                <a className="brief-cta" href={`/brief/${latest}`} data-auth-required>
                  Read it →
                </a>
                <a className="brief-dl" href={`/brief/${latest}?download=1`} data-auth-required>
                  Download PDF
                </a>
              </div>
            </div>
          ) : (
            <p className="brief-empty">
              The first issue goes out tomorrow at 8:00 in the morning. Until
              then, every filing is on the <a href="/dashboard">dashboard</a>.
            </p>
          )}

          {/* ---- subscribe, on the same page ---- */}
          <div className="sub-card" id="subscribe">
            {state === "done" ? (
              <div className="sub-done">
                <b>You&apos;re in.</b>
                <p>
                  The next brief lands tomorrow at 8:00 in the morning. Now join
                  the WhatsApp community below — that&apos;s where the day gets
                  discussed.
                </p>
              </div>
            ) : (
              <form onSubmit={submit} className="sub-form">
                <label htmlFor="sub-email" className="sub-label">
                  Get it in your inbox
                </label>
                <div className="sub-row">
                  <input
                    id="sub-email"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(ev) => {
                      setEmail(ev.target.value);
                      if (error) setError("");
                    }}
                  />
                  <button className="btn-lg btn-grad" disabled={!ready || state === "sending"}>
                    {!ready ? "Checking…" : state === "sending" ? "Signing you up…" : "Subscribe free"}
                  </button>
                </div>

                {/* Hidden from people, filled in by bots. */}
                <input
                  className="hp"
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden="true"
                  value={company}
                  onChange={(ev) => setCompany(ev.target.value)}
                />

                {error && <p className="sub-error">{error}</p>}
                <p className="sub-note">
                  Free, one email a day. By subscribing, you agree that Market
                  Tide may securely add your address to its newsletter audience.
                  You can unsubscribe at any time.
                </p>
              </form>
            )}
          </div>

          <div className="sub-and"><span className="sub-step">Then</span></div>

          <a
            className="btn-lg btn-wa"
            href={SITE.newsletterLink}
            target="_blank"
            rel="noopener noreferrer"
          >
            Join the WhatsApp community
          </a>
          <p className="mk-ctanote">
            Do both. The email brings the PDF each morning; the group is where
            the day gets discussed.
          </p>
        </section>

        <section className="mk-sec">
          <div className="mk-sec-head">
            <p className="mk-kicker">What you get</p>
            <h2 className="mk-h2">One PDF. Fifty filings. No noise.</h2>
          </div>
          <div className="bento">
            <div className="bx wide">
              <h3>Only what happened</h3>
              <p>
                Concall invitations, investor presentations and meeting notices
                are left out — a diary entry is not news. So are dividends and
                splits, which are routine enough to crowd out everything else.
              </p>
            </div>
            <div className="bx wide">
              <h3>Overnight filings included</h3>
              <p>
                It covers everything filed from the start of yesterday until 7
                o&apos;clock this morning, so an announcement made late at night
                reaches you at breakfast, not a day later.
              </p>
            </div>
            <div className="bx wide">
              <h3>Plain English, with the numbers</h3>
              <p>
                Every entry gives the company, its market cap, what was
                announced, the figures that matter, and one line on why it
                matters. Written from the filing itself.
              </p>
            </div>
            <div className="bx wide">
              <h3>Everything else is still there</h3>
              <p>
                The brief is the fifty worth your morning. Every filing we read
                — including the ones it leaves out — stays searchable on the{" "}
                <a href="/dashboard">dashboard</a>, free.
              </p>
            </div>
          </div>
        </section>
        </main>
        <MkFooter />
    </>
  );
}
