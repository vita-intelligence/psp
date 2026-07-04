"use client";

// Small client-only sibling for TopBar that derives the current
// pageId from the URL pathname and renders PagePresenceAvatars +
// the viewport-anchored global cursor overlay. Every page inherits
// universal presence + live cursors with zero per-page opt-in.

import { usePathname } from "next/navigation";
import { PagePresenceAvatars } from "./page-presence-avatars";
import { GlobalPageCursors } from "./global-page-cursors";

const DISABLED_PREFIXES = ["/login", "/logout", "/auth"];

export function TopBarPresence() {
  const pathname = usePathname();
  const disabled =
    !pathname ||
    DISABLED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  return (
    <>
      <PagePresenceAvatars pageId={pathname ?? ""} disabled={disabled} />
      <GlobalPageCursors />
    </>
  );
}
