"use client";

import { useEffect, useState } from "react";
import Nav from "../../Nav";
import MkFooter from "../../MkFooter";
import { useSiteAuth } from "../../SiteAuth";

export default function PaymentReturnPage() {
  const { checking, user, openAuth } = useSiteAuth();
  const [result, setResult] = useState({ state: "checking", message: "Verifying your payment securely…" });

  useEffect(() => {
    if (checking || !user) return;
    const orderId = new URLSearchParams(window.location.search).get("order_id");
    if (!orderId) {
      setResult({ state: "error", message: "This payment link does not contain an order number." });
      return;
    }

    let active = true;
    fetch(`/api/payments/status?order_id=${encodeURIComponent(orderId)}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not verify this payment.");
        if (!active) return;
        if (data.status === "PAID") {
          const until = data.subscriptionEndsAt
            ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric" }).format(new Date(data.subscriptionEndsAt))
            : null;
          setResult({
            state: "success",
            message: until
              ? `Premium is active until ${until}.`
              : "Premium is now active for three months.",
          });
        } else {
          setResult({
            state: "pending",
            message: "Cashfree has not confirmed this payment yet. If you paid, wait a moment and check again.",
          });
        }
      })
      .catch((error) => active && setResult({ state: "error", message: error.message }))
      .finally(() => {});
    return () => { active = false; };
  }, [checking, user]);

  function retry() {
    window.location.reload();
  }

  return (
    <>
      <Nav />
      <main className="mk payment-page">
        <section className={`payment-result payment-result--${result.state}`}>
          <span className="payment-result-icon" aria-hidden="true">
            {result.state === "success" ? "✓" : result.state === "error" ? "!" : "…"}
          </span>
          <p className="mk-kicker">Market Tide Premium</p>
          <h1>{result.state === "success" ? "Payment successful" : result.state === "pending" ? "Payment pending" : result.state === "error" ? "We could not verify it" : "Checking payment"}</h1>
          <p>{result.message}</p>

          {!checking && !user ? (
            <button className="btn-lg btn-grad" type="button" onClick={() => openAuth({ clear: true })}>
              Sign in to verify payment
            </button>
          ) : null}
          {result.state === "pending" || result.state === "error" ? (
            <button className="btn-lg btn-ghost" type="button" onClick={retry}>Check again</button>
          ) : null}
          {result.state === "success" ? <a className="btn-lg btn-grad" href="/profile">View my plan</a> : null}
          <a className="payment-back" href="/pricing">Back to pricing</a>
        </section>
      </main>
      <MkFooter />
    </>
  );
}
