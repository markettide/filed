"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { SITE } from "./site";
import { useSiteAuth } from "./SiteAuth";

export default function Nav() {
  const pathname = usePathname();
  const { ready, user, openAuth, logout } = useSiteAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => setMenuOpen(false), [pathname]);

  const current = (href) =>
    pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));

  async function signOut() {
    await logout();
    window.location.href = "/";
  }

  function link(href, label) {
    return (
      <a href={href} className={current(href) ? "nav-active" : ""} aria-current={current(href) ? "page" : undefined}>
        {label}
      </a>
    );
  }

  const trialDaysLeft = user?.access?.trialActive && user.access.trialEndsAt
    ? Math.max(1, Math.ceil((new Date(user.access.trialEndsAt) - new Date()) / 86400000))
    : 0;
  const planLabel = user?.access?.trialAvailable
    ? "Start free trial"
    : trialDaysLeft
      ? `Trial · ${trialDaysLeft}d left`
      : "Plans";

  return (
    <nav className="nav">
      <div className="nav-in">
        <a className="nav-brand" href="/">
          <span className="dot" /><span>{SITE.name}</span>
        </a>
        <button
          type="button"
          className="nav-menu"
          aria-expanded={menuOpen}
          aria-controls="primary-navigation"
          aria-label={menuOpen ? "Close navigation" : "Open navigation"}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span /><span /><span />
        </button>
        <div className={`nav-links${menuOpen ? " open" : ""}`} id="primary-navigation">
          {link("/dashboard", "Dashboard")}
          {link("/brief", "Daily brief")}
          {link("/insider", "Insider trading")}
          {link("/deals", "Bulk & block")}
          {user ? (
            <>
              {link("/profile", "Profile")}
              <button type="button" className="nav-account nav-logout" onClick={signOut}>Log out</button>
            </>
          ) : ready ? (
            <button
              type="button"
              className="nav-account"
              onClick={() => {
                setMenuOpen(false);
                openAuth({ clear: true, returnTo: pathname === "/" ? "/dashboard" : null });
              }}
            >
              Sign in
            </button>
          ) : null}
          <a className="nav-cta" href="/pricing" aria-current={current("/pricing") ? "page" : undefined}>
            {planLabel}
          </a>
        </div>
      </div>
    </nav>
  );
}
