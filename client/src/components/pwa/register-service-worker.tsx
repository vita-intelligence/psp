"use client";

import { useEffect } from "react";

// Mobile / tablet UA sniff. Covers iOS Safari (iPhone / iPad in
// desktop-mode reports "Macintosh" but the Touch event API + the
// "Mobile" token in native mode catch it), Android Chrome / Samsung
// Internet, Windows tablets, and the various generic "Mobile" tokens
// Chromium adds when a touch-first form factor is detected.
//
// UA sniffing is imperfect but "good enough" for suppressing an
// install banner — the manifest itself still exists, so a
// power-user on desktop can install via Chrome's ⋮ menu if they
// insist. What we're preventing is the automatic pop-up that would
// otherwise nag office users who never wanted the mobile shell.
const MOBILE_UA = /Android|iPhone|iPad|iPod|Mobile|Tablet|Silk|Kindle/i;

function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;

  // Modern UA-CH signal — Chromium exposes this and it's the
  // canonical answer when available. Firefox / Safari don't ship
  // it yet, so we fall through to UA sniffing.
  const uaData = (
    navigator as Navigator & { userAgentData?: { mobile?: boolean } }
  ).userAgentData;
  if (uaData && typeof uaData.mobile === "boolean") return uaData.mobile;

  // iPadOS 13+ reports as "Macintosh" in the UA. Detect it via
  // multi-touch — no desktop Mac reports touch points.
  const iPadOSInDesktopMode =
    navigator.platform === "MacIntel" &&
    typeof navigator.maxTouchPoints === "number" &&
    navigator.maxTouchPoints > 1;
  if (iPadOSInDesktopMode) return true;

  return MOBILE_UA.test(navigator.userAgent);
}

/**
 * Registers the minimal service worker at `/sw.js` — but ONLY on
 * mobile devices. Desktop browsers skip registration entirely so
 * Chrome / Edge don't offer to install PSP on office machines that
 * will never use the warehouse tile grid.
 *
 * The registration is fire-and-forget: any error is logged but
 * never surfaced to the user. Service-worker failure is a graceful
 * degradation (the site still works, it just isn't installable), so
 * we don't want a toast or banner tripping every warehouse phone
 * whose vendor mangles the SW API.
 *
 * Development note: Next / Turbopack HMR does NOT play well with a
 * service worker that intercepts navigations. Our SW has an empty
 * fetch handler on purpose so HMR passes straight through.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    // Desktop path — actively unregister any SW that was installed
    // during an earlier visit (e.g. when this component didn't yet
    // gate on the form factor, or if a phone hit the same laptop's
    // browser profile). Prevents Chrome from continuing to offer
    // "Install app" on office machines.
    if (!isMobileDevice()) {
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => regs.forEach((r) => r.unregister()))
        .catch(() => {
          // Some hardened browsers refuse to enumerate — treat as
          // a no-op; there's nothing we can do and it doesn't hurt.
        });
      return;
    }

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch((err) => {
          console.warn("[pwa] service worker registration failed", err);
        });
    };

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
