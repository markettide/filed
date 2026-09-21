"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AuthPanel } from "./AuthGate";

const SiteAuthContext = createContext(null);
const AUTO_OPEN_PATHS = new Set(["/brief", "/join"]);

export function SiteAuthProvider({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [ready, setReady] = useState(true);
  const [user, setUser] = useState(null);
  const [modal, setModal] = useState(null);
  const autoShown = useRef(new Set());
  const pending = useRef({});

  const openAuth = useCallback((options = {}) => {
    pending.current = {
      returnTo: options.returnTo || null,
      onAuthenticated: options.onAuthenticated || null,
    };
    setModal({
      email: String(options.email || ""),
      phone: String(options.phone || ""),
      clear: options.clear !== false,
    });
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (!active) return;
        setReady(Boolean(data.ready));
        setUser(data.user || null);
      })
      .catch(() => {})
      .finally(() => active && setChecking(false));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!user || user.access) return undefined;
    let active = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (active && data.user) setUser(data.user);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [user]);

  useEffect(() => {
    if (checking || user || !ready || !AUTO_OPEN_PATHS.has(pathname)) return;
    if (autoShown.current.has(pathname)) return;
    autoShown.current.add(pathname);
    openAuth({ clear: true });
  }, [checking, openAuth, pathname, ready, user]);

  useEffect(() => {
    const open = (event) => openAuth(event.detail || {});
    const sync = (event) => {
      if (event.detail?.signedIn) setUser(event.detail.user || { id: "", channel: "email" });
      else setUser(null);
    };
    window.addEventListener("market-tide-open-auth", open);
    window.addEventListener("market-tide-auth", sync);
    return () => {
      window.removeEventListener("market-tide-open-auth", open);
      window.removeEventListener("market-tide-auth", sync);
    };
  }, [openAuth]);

  useEffect(() => {
    if (user || !ready) return undefined;
    const protect = (event) => {
      const target = event.target.closest?.("[data-auth-required]");
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      openAuth({ clear: true });
    };
    document.addEventListener("click", protect, true);
    return () => document.removeEventListener("click", protect, true);
  }, [openAuth, ready, user]);

  useEffect(() => {
    document.body.classList.toggle("auth-open", Boolean(modal));
    return () => document.body.classList.remove("auth-open");
  }, [modal]);

  function authenticated(data) {
    const signedInUser = data?.user || {
      id: data?.id || modal?.email || "",
      channel: data?.channel || "email",
      phone: modal?.phone || null,
    };
    setUser(signedInUser);
    setModal(null);
    window.dispatchEvent(new CustomEvent("market-tide-auth", {
      detail: { signedIn: true, user: signedInUser },
    }));
    const next = pending.current;
    pending.current = {};
    next.onAuthenticated?.(signedInUser);
    if (next.returnTo && next.returnTo !== pathname) router.push(next.returnTo);
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    window.dispatchEvent(new CustomEvent("market-tide-auth", {
      detail: { signedIn: false, user: null },
    }));
  }

  return (
    <SiteAuthContext.Provider value={{ checking, ready, user, openAuth, logout }}>
      {children}
      {modal && (
        <div className={`auth-overlay${modal.clear ? " auth-overlay--clear" : ""}`}>
          <AuthPanel
            key={`${modal.email}:${modal.phone}`}
            ready={ready}
            initialEmail={modal.email}
            initialPhone={modal.phone}
            onAuthenticated={authenticated}
            onClose={() => { pending.current = {}; setModal(null); }}
          />
        </div>
      )}
    </SiteAuthContext.Provider>
  );
}

export function useSiteAuth() {
  const value = useContext(SiteAuthContext);
  if (!value) throw new Error("useSiteAuth must be used inside SiteAuthProvider");
  return value;
}
