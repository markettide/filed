"use client";

import { useEffect, useState } from "react";

function AuthPanel({ ready = true, initialEmail = "", initialPhone = "", onAuthenticated, onClose }) {
  const [step, setStep] = useState("email");
  const [email, setEmail] = useState(() => String(initialEmail).trim().toLowerCase());
  const [phone, setPhone] = useState(() => String(initialPhone).replace(/\D/g, "").slice(-10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function signIn(withPhone = "") {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, phone: withPhone }),
      });
      const data = await response.json();
      if (data.needsPhone) {
        setStep("phone");
        if (withPhone) setError(data.error || "Check your mobile number.");
        return;
      }
      if (!response.ok) {
        setError(data.error || "We could not sign you in. Please try again.");
        return;
      }
      onAuthenticated?.(data);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function submitEmail(event) {
    event.preventDefault();
    await signIn();
  }

  async function submitPhone(event) {
    event.preventDefault();
    await signIn(phone);
  }

  return (
    <section className="auth-card" role="dialog" aria-modal="true" aria-labelledby="auth-title">
      <button type="button" className="auth-close" onClick={onClose} aria-label="Close sign-in popup">×</button>
      <div className="auth-mark"><span className="dot" /> Market Tide</div>
      <p className="auth-kicker">Member access</p>
      <h1 id="auth-title">Sign in to continue</h1>
      <p className="auth-copy">
        Sign in to manage your free newsletter, trial and Premium access.
        No password to remember.
      </p>

      {!ready ? (
        <div className="auth-error" role="alert">
          Sign-in setup is incomplete. Add MongoDB, email and authentication settings in Vercel.
        </div>
      ) : step === "email" ? (
        <form onSubmit={submitEmail} className="auth-form">
          <label htmlFor="gate-email">Email address</label>
          <input
            id="gate-email"
            type="email"
            required
            autoFocus
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@email.com"
          />
          <button type="submit" disabled={busy}>
            {busy ? "Checking…" : "Continue with email"}
          </button>
          <p className="auth-note">
            Returning member? We&apos;ll recognize your email and won&apos;t ask for your phone again.
          </p>
        </form>
      ) : (
        <form onSubmit={submitPhone} className="auth-form">
          <div className="auth-identity">
            <span>Creating an account for</span><b>{email}</b>
          </div>
          <label htmlFor="gate-phone">Mobile number</label>
          <div className="auth-phone">
            <span>+91</span>
            <input
              id="gate-phone"
              type="tel"
              inputMode="numeric"
              required
              autoFocus
              autoComplete="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value.replace(/\D/g, "").slice(0, 10))}
              placeholder="98765 43210"
            />
          </div>
          <button type="submit" disabled={busy || phone.length !== 10}>
            {busy ? "Signing in…" : "Continue to Market Tide"}
          </button>
          <p className="auth-note">
            We ask for this once and save it securely for future sign-ins.
          </p>
          <button type="button" className="auth-link" onClick={() => { setStep("email"); setError(""); }}>
            Use a different email
          </button>
        </form>
      )}

      {error && <p className="auth-error" role="alert">{error}</p>}
      <p className="auth-trust">Secure email-based member access.</p>
    </section>
  );
}

export default function AuthGate({ children, mode = "locked" }) {
  const [status, setStatus] = useState("checking");
  const [ready, setReady] = useState(true);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (!active) return;
        const signInReady = Boolean(data.ready);
        setReady(signInReady);
        // Keep the current site available until every production service is
        // configured. As soon as they are ready, anonymous readers are gated.
        setStatus(data.user || !signInReady ? "open" : mode === "interaction" ? "idle" : "locked");
      })
      .catch(() => active && setStatus(mode === "interaction" ? "idle" : "locked"));
    return () => { active = false; };
  }, [mode]);

  const locked = mode === "locked" && (status === "locked" || status === "dismissed");
  const pending = mode === "locked" && status === "checking";
  const modalOpen = status === "locked";
  useEffect(() => {
    document.body.classList.toggle("auth-open", modalOpen);
    return () => document.body.classList.remove("auth-open");
  }, [modalOpen]);

  function requireAuthentication(event) {
    if (mode !== "interaction" || status === "open") return;
    const target = event.target.closest("[data-auth-required]");
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    setStatus("locked");
  }

  function authenticated(data) {
    setStatus("open");
    window.dispatchEvent(new CustomEvent("market-tide-auth", {
      detail: { signedIn: true, user: data?.user || null },
    }));
  }

  return (
    <>
      <div
        className={`${mode === "interaction" ? "auth-interactive" : "auth-protected"}${locked ? ` auth-protected--locked${status === "dismissed" ? " auth-protected--dismissed" : ""}` : ""}${pending ? " auth-protected--pending" : ""}`}
        aria-hidden={locked || pending}
        onClickCapture={requireAuthentication}
        onSubmitCapture={requireAuthentication}
      >
        {children}
      </div>
      {modalOpen && (
        <div className={`auth-overlay${mode === "interaction" ? " auth-overlay--clear" : ""}`}>
          <AuthPanel
            ready={ready}
            onAuthenticated={authenticated}
            onClose={() => setStatus(mode === "interaction" ? "idle" : "dismissed")}
          />
        </div>
      )}
      {status === "dismissed" && (
        <aside className="auth-lockbar" aria-live="polite">
          <div><b>Sign in free to unlock</b><span>Open the complete dashboard and every filing summary.</span></div>
          <div className="auth-lockbar-actions">
            <a href="/">Visit home page</a>
            <button type="button" onClick={() => setStatus("locked")}>Sign in free</button>
          </div>
        </aside>
      )}
    </>
  );
}

export { AuthPanel };
