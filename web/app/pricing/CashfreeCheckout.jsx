"use client";

import { useEffect, useState } from "react";
import { useSiteAuth } from "../SiteAuth";

let sdkPromise;

function loadCashfreeSdk() {
  if (typeof window === "undefined") return Promise.reject(new Error("Checkout is unavailable."));
  if (window.Cashfree) return Promise.resolve(window.Cashfree);
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      const existing = document.getElementById("cashfree-js-v3");
      if (existing) {
        existing.addEventListener("load", () => resolve(window.Cashfree), { once: true });
        existing.addEventListener("error", () => reject(new Error("Could not load Cashfree checkout.")), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.id = "cashfree-js-v3";
      script.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
      script.async = true;
      script.onload = () => resolve(window.Cashfree);
      script.onerror = () => reject(new Error("Could not load Cashfree checkout."));
      document.head.appendChild(script);
    });
  }
  return sdkPromise;
}

export default function CashfreeCheckout() {
  const { checking, ready, user, openAuth } = useSiteAuth();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [phoneNeeded, setPhoneNeeded] = useState(false);
  const [phone, setPhone] = useState("");
  const [access, setAccess] = useState(null);
  const [accessLoading, setAccessLoading] = useState(false);

  useEffect(() => {
    if (!user) {
      setAccess(null);
      return;
    }
    let active = true;
    setAccessLoading(true);
    fetch("/api/access", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not check your plan.");
        if (active) setAccess(data.access);
      })
      .catch((error) => active && setNotice({ type: "error", text: error.message }))
      .finally(() => active && setAccessLoading(false));
    return () => { active = false; };
  }, [user]);

  async function startTrial() {
    if (!user) {
      openAuth({ clear: true, returnTo: "/pricing" });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/trial/start", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not start your trial.");
      setAccess(data.access);
      setNotice({ type: "success", text: "Your seven-day Premium trial is active. No card was charged." });
    } catch (error) {
      setNotice({ type: "error", text: error.message || "Could not start your trial." });
    } finally {
      setBusy(false);
    }
  }

  async function startCheckout(phoneOverride = "") {
    if (!user) {
      openAuth({
        clear: true,
        returnTo: "/pricing",
        onAuthenticated: () => setNotice({ type: "success", text: "Signed in. Select checkout once more to continue." }),
      });
      return;
    }

    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/payments/create-order", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: phoneOverride }),
      });
      const data = await response.json();
      if (data.code === "phone_required") {
        setPhoneNeeded(true);
        throw new Error(data.error);
      }
      if (!response.ok) throw new Error(data.error || "Could not start checkout.");

      const Cashfree = await loadCashfreeSdk();
      if (!Cashfree) throw new Error("Cashfree checkout did not load.");
      const cashfree = Cashfree({ mode: data.mode || "sandbox" });
      await cashfree.checkout({
        paymentSessionId: data.paymentSessionId,
        redirectTarget: "_self",
      });
    } catch (error) {
      setNotice({ type: "error", text: error.message || "Could not start checkout." });
      setBusy(false);
    }
  }

  function submitPhone(event) {
    event.preventDefault();
    startCheckout(phone);
  }

  function primaryAction() {
    if (!user) {
      openAuth({ clear: true, returnTo: "/pricing" });
      return;
    }
    if (access?.trialAvailable) {
      startTrial();
      return;
    }
    if (access?.premium) {
      window.location.href = "/dashboard";
      return;
    }
    startCheckout();
  }

  const buttonText = busy
    ? access?.trialAvailable ? "Starting your trial…" : "Opening secure checkout…"
    : !user
      ? "Sign in to start free trial"
      : accessLoading || !access
        ? "Checking your access…"
        : access.paidActive
          ? "Open Premium dashboard"
          : access.trialActive
            ? "Open Premium dashboard"
            : access.trialAvailable
              ? "Start free 7-day trial"
              : "Get Premium — ₹299";

  return (
    <div className="checkout-box">
      <button
        className="btn-lg btn-grad plan-action checkout-button"
        type="button"
        disabled={checking || busy || !ready || Boolean(user && accessLoading)}
        onClick={primaryAction}
      >
        {buttonText}
      </button>

      {access?.trialActive && (
        <button
          className="btn-lg btn-ghost plan-action checkout-early-payment"
          type="button"
          disabled={busy}
          onClick={() => startCheckout()}
        >
          Buy Premium now — ₹299
        </button>
      )}

      {phoneNeeded && (
        <form className="checkout-phone" onSubmit={submitPhone}>
          <label htmlFor="checkout-phone">Mobile number required for payment</label>
          <div>
            <span>+91</span>
            <input
              id="checkout-phone"
              value={phone}
              onChange={(event) => setPhone(event.target.value.replace(/\D/g, "").slice(0, 10))}
              inputMode="numeric"
              autoComplete="tel"
              placeholder="9876543210"
              minLength={10}
              maxLength={10}
              required
            />
            <button type="submit" disabled={busy || phone.length !== 10}>Continue</button>
          </div>
        </form>
      )}

      {notice && <p className={`checkout-notice ${notice.type}`} role="status">{notice.text}</p>}
      <p className="plan-fine">
        {access?.trialActive
          ? `Free trial active until ${new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric" }).format(new Date(access.trialEndsAt))}. Pay now only if you want paid access to begin immediately.`
          : access?.paidActive
            ? `Premium active until ${new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric" }).format(new Date(access.paidEndsAt))}.`
            : access?.trialAvailable
              ? "No card required. No automatic charge after seven days."
              : "One-time payment. Premium remains active for three months."}
      </p>
    </div>
  );
}
