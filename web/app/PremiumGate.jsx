"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Nav from "./Nav";
import MkFooter from "./MkFooter";
import { useSiteAuth } from "./SiteAuth";

export default function PremiumGate({ children }) {
  const { checking: authChecking, ready, user, openAuth } = useSiteAuth();
  const pathname = usePathname();
  const [access, setAccess] = useState(null);
  const [error, setError] = useState("");
  const [startingTrial, setStartingTrial] = useState(false);
  const authPrompted = useRef(false);
  const gateTracked = useRef(false);

  const loadAccess = useCallback(async () => {
    if (!user) {
      setAccess(null);
      return;
    }
    setError("");
    try {
      const response = await fetch("/api/access", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not check your access.");
      setAccess(data.access);
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [user]);

  useEffect(() => { loadAccess(); }, [loadAccess]);

  useEffect(() => {
    if (authChecking || user || !ready || authPrompted.current) return;
    authPrompted.current = true;
    openAuth({ clear: true });
  }, [authChecking, openAuth, ready, user]);

  useEffect(() => { gateTracked.current = false; }, [pathname]);

  useEffect(() => {
    if (!user || !access?.trialAvailable || gateTracked.current) return;
    gateTracked.current = true;
    fetch("/api/trial/funnel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "gate_view", path: pathname }),
      keepalive: true,
    }).catch(() => {});
  }, [access, pathname, user]);

  async function startTrial() {
    setStartingTrial(true);
    setError("");
    fetch("/api/trial/funnel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "cta_click", path: pathname }),
      keepalive: true,
    }).catch(() => {});
    try {
      const response = await fetch("/api/trial/start", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not start your trial.");
      setAccess(data.access);
      window.dispatchEvent(new CustomEvent("market-tide-auth", {
        detail: { signedIn: true, user: { ...user, plan: data.access.level, access: data.access } },
      }));
    } catch (startError) {
      setError(startError.message || "Could not start your trial. Please try again.");
    } finally {
      setStartingTrial(false);
    }
  }

  if (user && access?.premium) return children;

  const loading = authChecking || (user && !access && !error);
  return (
    <>
      <Nav />
      <main className="mk premium-gate-shell">
        <section className={`premium-gate-card${user && !loading ? " premium-gate-card--prompt" : ""}`} role={user && !loading ? "dialog" : undefined} aria-modal={user && !loading ? "true" : undefined}>
          <span className="premium-gate-mark" aria-hidden="true">MT</span>
          <p className="mk-kicker">Premium workspace</p>
          {loading ? (
            <><h1>Checking your access…</h1><p>This will only take a moment.</p></>
          ) : !user ? (
            <>
              <h1>Sign in to continue</h1>
              <p>Sign in first, then start your free seven-day Premium trial. No card is required.</p>
              <button className="btn-lg btn-grad" type="button" disabled={!ready} onClick={() => openAuth({ clear: true })}>
                Sign in
              </button>
            </>
          ) : access?.trialAvailable ? (
            <>
              <h1>Unlock this page free for seven days</h1>
              <p>Explore the complete Market Tide research workspace now. Your trial starts with one click and opens the page you requested immediately.</p>
              <div className="premium-gate-benefits" aria-label="Trial benefits">
                <span>Full announcement dashboard</span>
                <span>Insider trading tracker</span>
                <span>Bulk and block deals</span>
              </div>
              <button className="btn-lg btn-grad" type="button" disabled={startingTrial} onClick={startTrial}>
                {startingTrial ? "Starting your trial…" : "Start my free 7-day trial"}
              </button>
              <p className="premium-gate-assurance">No card required · No automatic charge · Cancel nothing</p>
              <a className="premium-gate-free" href="/brief">Continue to the free newsletter</a>
            </>
          ) : (
            <>
              <h1>Your free trial has ended</h1>
              <p>Your newsletter remains free. Unlock the complete dashboard, insider trading and bulk/block deal trackers for ₹299 for three months.</p>
              <a className="btn-lg btn-grad" href="/pricing">View Premium plan</a>
              <a className="premium-gate-free" href="/brief">Go to the free newsletter</a>
            </>
          )}
          {error && <p className="premium-gate-error" role="alert">{error}</p>}
        </section>
      </main>
      <MkFooter />
    </>
  );
}
