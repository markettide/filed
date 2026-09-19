"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Nav from "./Nav";
import MkFooter from "./MkFooter";
import { useSiteAuth } from "./SiteAuth";

export default function PremiumGate({ children }) {
  const { checking: authChecking, ready, user, openAuth } = useSiteAuth();
  const [access, setAccess] = useState(null);
  const [error, setError] = useState("");
  const authPrompted = useRef(false);

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
              <h1>Start your free trial to open this page</h1>
              <p>You are signed in, but Premium access has not started. Visit Plans to activate your free seven-day trial. No card is required.</p>
              <a className="btn-lg btn-grad" href="/pricing">Go to Plans and start trial</a>
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
