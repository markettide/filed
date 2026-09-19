"use client";

import { useEffect, useState } from "react";
import Nav from "../Nav";
import MkFooter from "../MkFooter";
import { PLANS, SITE } from "../site";
import { useSiteAuth } from "../SiteAuth";

const BENEFITS = [
  {
    no: "01",
    title: "Private Market Community",
    body: "Connect with serious investors, traders and equity researchers who genuinely follow the markets.",
  },
  {
    no: "02",
    title: "Daily Market Conversations",
    body: "Discuss important market moves, sectors, companies, results and developments without the noise.",
  },
  {
    no: "03",
    title: "Stock & Business Discussions",
    body: "Bring your own ideas and research. Debate the thesis, risks, opportunities and business fundamentals with other members.",
  },
  {
    no: "04",
    title: "Offline Investor Meetups",
    body: "Meet fellow members in person, exchange ideas, build relationships and expand your network.",
  },
  {
    no: "05",
    title: "Expert Conversations",
    body: "Members-only sessions with investors, analysts, founders and professionals from the financial ecosystem.",
  },
  {
    no: "06",
    title: "Equity Research Sessions",
    body: "Learn practical approaches to analysing companies, annual reports, financials, valuations and investment theses.",
  },
  {
    no: "07",
    title: "IPO & Corporate Action Discussions",
    body: "Discuss IPOs, results, corporate actions and important company announcements from an investor's perspective.",
  },
  {
    no: "08",
    title: "Member Research",
    body: "Share your own stock research, investment frameworks and company notes. Get different perspectives from the community.",
  },
];

export default function Join() {
  const { ready, user, openAuth } = useSiteAuth();
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState(""); // honeypot
  const [state, setState] = useState("idle");
  const [error, setError] = useState("");

  const waLink = `https://wa.me/${SITE.phoneDigits}?text=${encodeURIComponent(
    "Hi, I'd like to join The Equity Markets Club."
  )}`;

  useEffect(() => {
    if (user?.id && !email) setEmail(user.id);
    if (user?.phone && !phone) setPhone(user.phone.replace(/^\+91/, ""));
  }, [email, phone, user]);

  async function reserve(details) {
    if (state === "sending") return;
    setState("sending");
    setError("");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: details.email, phone: details.phone, company, source: "club" }),
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
    if (!user && ready) {
      openAuth({
        clear: true,
        email,
        phone,
        onAuthenticated: (signedInUser) => {
          const details = {
            email: email || signedInUser?.id || "",
            phone: phone || signedInUser?.phone?.replace(/^\+91/, "") || "",
          };
          setEmail(details.email);
          setPhone(details.phone);
          reserve(details);
        },
      });
      return;
    }
    reserve({ email: email || user?.id || "", phone: phone || user?.phone || "" });
  }

  return (
    <>
      <Nav />
        <main className="mk">
        {/* ---------------- hero ---------------- */}
        <section className="mk-hero">
          <div className="launch-banner">
            Included with Premium
          </div>

          <h1 className="mk-h1">
            The Equity{" "}
            <br />
            <span className="grad">Markets Club</span>
          </h1>

          <div className="price-tag" style={{ justifyContent: "center" }}>
            <b>₹{PLANS.premium.price}</b>
            <span>/ {PLANS.premium.months} months with Premium</span>
          </div>

          <p className="mk-sub" style={{ marginTop: 22 }}>
            <strong>
              A private community for people who take equity markets seriously.
            </strong>
          </p>

          <div className="mk-narrow" style={{ textAlign: "left", maxWidth: 360, margin: "0 auto" }}>
            <div className="nots">
              <span>Not a tip group.</span>
              <span>Not a stock advisory service.</span>
              <span>Not another noisy Telegram channel.</span>
            </div>
          </div>

          <p className="mk-sub">
            A place to <strong>meet, discuss, learn, research and network</strong>{" "}
            with serious investors, traders and equity-market enthusiasts.
          </p>

          <div className="mk-ctas">
            <a className="btn-lg btn-grad" href="#join">
              Join the Premium community
            </a>
            <a className="btn-lg btn-ghost" href="/dashboard" data-auth-required>
              Explore the Premium dashboard
            </a>
          </div>
        </section>

        {/* ---------------- what members get ---------------- */}
        <section className="mk-sec">
          <div className="mk-sec-head">
            <p className="mk-kicker">Members get access to</p>
            <h2 className="mk-h2">Eight things, all of them people</h2>
          </div>

          <div className="club-grid">
            {BENEFITS.map((b) => (
              <div className="club-item" key={b.no}>
                <span className="club-no">{b.no}</span>
                <h3>{b.title}</h3>
                <p>{b.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ---------------- who should join ---------------- */}
        <section className="mk-sec">
          <div className="mk-sec-head">
            <p className="mk-kicker">Who should join?</p>
            <p className="who-line">
              Investors. Traders. Equity Researchers. Finance Professionals.
              Market Enthusiasts.
            </p>
            <p className="mk-lead">
              If you spend time understanding businesses, analysing stocks,
              following markets or researching investment opportunities —{" "}
              <strong style={{ color: "var(--ink)" }}>this club is for you.</strong>
            </p>
          </div>
        </section>

        {/* ---------------- join ---------------- */}
        <section className="mk-sec" id="join">
          <div className="price-wrap">
            <div className="price-card">
              <p className="mk-kicker" style={{ marginBottom: 4 }}>
                Premium community
              </p>
              <div className="price-tag">
                <b>₹{PLANS.premium.price}</b>
                <span>/ {PLANS.premium.months} months</span>
              </div>
              <p className="price-note">
                The private community is included with Premium alongside the
                full dashboard, filing history, original PDFs and Excel exports.
              </p>

              <div className="seatbar">
                <div className="seatbar-track">
                  <div className="seatbar-fill" style={{ width: "18%" }} />
                </div>
                <span>No card or payment is needed to register your interest.</span>
              </div>

              {state === "done" ? (
                <div className="done">
                  <b>Your interest is registered.</b>
                  <p>
                    We&apos;ll send you the community joining details for your
                    Premium access.
                  </p>
                  <a
                    className="wa-btn"
                    href={waLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ marginTop: 12 }}
                  >
                    <WaIcon /> Message us directly
                  </a>
                </div>
              ) : (
                <>
                  <form onSubmit={submit}>
                    <div className="row">
                      <input
                        type="email"
                        value={email}
                        required
                        autoComplete="email"
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@email.com"
                        aria-label="Email address"
                      />
                      <input
                        className="hp"
                        type="text"
                        tabIndex={-1}
                        aria-hidden="true"
                        autoComplete="off"
                        value={company}
                        onChange={(e) => setCompany(e.target.value)}
                      />
                    </div>
                    <div className="row phone-row">
                      <div className="phone-wrap">
                        <span className="cc">+91</span>
                        <input
                          className="phone"
                          type="tel"
                          inputMode="numeric"
                          maxLength={14}
                          required
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="WhatsApp number"
                          aria-label="WhatsApp number"
                        />
                      </div>
                      <button type="submit" disabled={state === "sending"}>
                        {state === "sending" ? "Joining…" : "Register interest"}
                      </button>
                    </div>
                    {error && <p className="err">{error}</p>}
                  </form>
                  <p className="note" style={{ marginTop: 10 }}>
                    Start your free trial from the Plans page. Payment is offered
                    only after the trial ends.
                  </p>
                </>
              )}
            </div>

            <div>
              <div className="why-card" style={{ marginBottom: 14 }}>
                <h3>What this club is not</h3>
                <div className="nots" style={{ marginBottom: 0 }}>
                  <span>No stock tips.</span>
                  <span>No guaranteed returns.</span>
                  <span>No buy/sell calls.</span>
                </div>
                <p style={{ marginTop: 16 }}>
                  <strong>
                    Just serious people talking seriously about equity markets.
                  </strong>
                </p>
              </div>

              <div className="why-card">
                <h3>Before you join</h3>
                <p>
                  Payment is not connected yet. Joining this list does not start
                  a subscription or create a charge. We will publish the final
                  billing and cancellation terms before Premium opens. See the{" "}
                  <a href="/refund">refund policy</a> for the current policy.
                </p>
                <p>
                  We are not a SEBI-registered research analyst or investment
                  adviser. Nothing here is a recommendation to buy or sell. See
                  the <a href="/terms">terms</a>.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------- closing ---------------- */}
        <section className="mk-sec">
          <div className="finale">
            <h2>Included with Premium</h2>
            <p className="closing">
              The full research workspace and private investor community, together
              for ₹{PLANS.premium.price} every {PLANS.premium.months} months.
            </p>
            <div className="nots"
                 style={{ maxWidth: 260, margin: "24px auto", textAlign: "left" }}>
              <span>No stock tips.</span>
              <span>No guaranteed returns.</span>
              <span>No buy/sell calls.</span>
            </div>
            <p className="closing" style={{ marginBottom: 26 }}>
              Just serious people talking seriously about equity markets.
            </p>
            <div className="mk-ctas">
              <a className="btn-lg btn-grad" href="#join">
                Join the Premium community
              </a>
              <a
                className="btn-lg btn-wa"
                href={waLink}
                target="_blank"
                rel="noopener noreferrer"
              >
                <WaIcon /> Ask us anything
              </a>
            </div>
          </div>
        </section>
        </main>

        <MkFooter />
    </>
  );
}

function WaIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.47 14.38c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.64.08-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.47-1.75-1.65-2.05-.17-.3-.02-.46.13-.6.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.6-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.01-1.04 2.47s1.06 2.86 1.21 3.06c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.69.63.71.22 1.36.19 1.87.12.57-.09 1.75-.72 2-1.41.25-.69.25-1.28.17-1.41-.07-.13-.27-.2-.57-.35z" />
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.46 1.32 4.96L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2zm0 18.15h-.01a8.22 8.22 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23 2.2 0 4.27.86 5.83 2.42a8.18 8.18 0 0 1 2.41 5.82c0 4.54-3.7 8.23-8.24 8.23z" />
    </svg>
  );
}
