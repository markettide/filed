"use client";

import { useEffect, useState } from "react";
import Nav from "../Nav";
import MkFooter from "../MkFooter";
import { useSiteAuth } from "../SiteAuth";
import { PLANS } from "../site";
import "../account.css";

export default function ProfilePage() {
  const { checking, ready, user, openAuth, logout } = useSiteAuth();
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState({ name: "", phone: "" });
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    fetch("/api/profile", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load your profile.");
        setProfile(data.profile);
        setForm({ name: data.profile.name || "", phone: data.profile.phone || "" });
      })
      .catch((error) => setNotice({ type: "error", text: error.message }))
      .finally(() => setLoading(false));
  }, [user]);

  async function save(event) {
    event.preventDefault();
    setLoading(true);
    setNotice(null);
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save your profile.");
      setProfile(data.profile);
      setForm({ name: data.profile.name || "", phone: data.profile.phone || "" });
      setNotice({ type: "success", text: "Your profile has been saved." });
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    } finally {
      setLoading(false);
    }
  }

  async function joinNewsletter() {
    setLoading(true);
    setNotice(null);
    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: profile.email, phone: profile.phone, source: "brief" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not activate the newsletter.");
      setProfile((current) => ({
        ...current,
        newsletter: { ...current.newsletter, subscribed: true, deliveryStatus: "synced" },
      }));
      setNotice({ type: "success", text: "The free newsletter is active for your email." });
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    } finally {
      setLoading(false);
    }
  }

  async function signOut() {
    await logout();
    window.location.href = "/";
  }

  const access = profile?.subscription?.access;
  const hasPremiumAccess = Boolean(access?.premium);
  const isTrial = Boolean(access?.trialActive);

  if (checking) {
    return <><Nav /><main className="mk profile-shell"><div className="profile-loading">Loading your account…</div></main></>;
  }

  if (!user) {
    return (
      <>
        <Nav />
        <main className="mk profile-shell">
          <section className="profile-signed-out">
            <span className="profile-icon" aria-hidden="true">MT</span>
            <p className="mk-kicker">Your account</p>
            <h1>Sign in to manage Market Tide</h1>
            <p>View your plan, update your contact details and manage newsletter access from one place.</p>
            {ready ? (
              <button className="btn-lg btn-grad" type="button" onClick={() => openAuth({ clear: true, returnTo: "/profile" })}>
                Sign in to continue
              </button>
            ) : <p className="profile-message error">Sign-in is temporarily unavailable.</p>}
          </section>
        </main>
        <MkFooter />
      </>
    );
  }

  return (
    <>
      <Nav />
      <main className="mk profile-shell">
        <header className="profile-header">
          <div>
            <p className="mk-kicker">Your account</p>
            <h1>{profile?.name ? `Welcome, ${profile.name.split(" ")[0]}` : "Your Market Tide profile"}</h1>
            <p>Only the details needed to deliver your account and newsletter are kept here.</p>
          </div>
          <button className="profile-signout" type="button" onClick={signOut}>Sign out</button>
        </header>

        {notice && <p className={`profile-message ${notice.type}`}>{notice.text}</p>}
        {loading && !profile ? <div className="profile-loading">Loading your account…</div> : null}

        {profile ? (
          <div className="profile-grid">
            <section className="profile-card profile-card--details">
              <div className="profile-card-head"><div><span>Personal details</span><h2>Your profile</h2></div></div>
              <form className="profile-form" onSubmit={save}>
                <label>
                  Full name <span>Optional</span>
                  <input value={form.name} maxLength={80} autoComplete="name" onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Your name" />
                </label>
                <label>
                  Email address
                  <input value={profile.email} disabled />
                  <small>Your email is your sign-in ID and cannot be changed here.</small>
                </label>
                <label>
                  Mobile number
                  <input value={form.phone} autoComplete="tel" inputMode="tel" onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="10-digit Indian mobile number" />
                </label>
                <button className="btn-lg btn-grad profile-save" type="submit" disabled={loading}>{loading ? "Saving…" : "Save changes"}</button>
              </form>
            </section>

            <div className="profile-side">
              <section className="profile-card plan-status-card">
                <span className="status-chip">{access?.paidActive ? "Premium" : isTrial ? "Free trial" : "Free plan"}</span>
                <h2>{hasPremiumAccess ? "Complete access" : "Newsletter only"}</h2>
                <p>{access?.paidActive
                  ? "Your paid Premium access is active."
                  : isTrial
                    ? "All Premium features are unlocked during your trial."
                    : access?.trialAvailable
                      ? "Start your free seven-day trial when you are ready."
                      : "Your trial has ended. The daily newsletter remains free."}</p>
                {!hasPremiumAccess && (
                  <a className="btn-lg btn-grad profile-card-action" href="/pricing">
                    {access?.trialAvailable ? "Start free 7-day trial" : `Premium · ₹${PLANS.premium.price} / ${PLANS.premium.months} months`}
                  </a>
                )}
                {hasPremiumAccess && <a className="btn-lg btn-ghost profile-card-action" href="/dashboard">Open Premium dashboard</a>}
                <small>{access?.paidActive && access.paidEndsAt
                  ? `Paid access is active until ${new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric" }).format(new Date(access.paidEndsAt))}.`
                  : isTrial && access.trialEndsAt
                    ? `Your trial ends on ${new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric" }).format(new Date(access.trialEndsAt))}. No automatic charge.`
                    : "₹299 is a one-time payment for three months of Premium access."}</small>
              </section>

              <section className="profile-card newsletter-status-card">
                <div className="profile-card-head"><div><span>Free plan</span><h2>Daily newsletter</h2></div><i className={profile.newsletter.subscribed ? "active" : ""} /></div>
                <p>{profile.newsletter.subscribed ? "Active — Market Tide can deliver the morning brief to your email." : "Not active yet. Join the free list to receive the morning brief."}</p>
                {profile.newsletter.subscribed ? (
                  <small>To stop delivery, use the unsubscribe link in any Market Tide email.</small>
                ) : (
                  <button className="btn-lg btn-ghost profile-card-action" type="button" onClick={joinNewsletter} disabled={loading}>{loading ? "Activating…" : "Activate free newsletter"}</button>
                )}
              </section>
            </div>
          </div>
        ) : null}
      </main>
      <MkFooter />
    </>
  );
}
