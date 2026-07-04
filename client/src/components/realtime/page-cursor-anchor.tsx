"use client";

// Lightweight client wrapper that hosts the PageCursors overlay for a
// detail page whose outer shell is a server component. Wrap the
// outermost content div (the `max-w-5xl space-y-6` block) in this and
// pass a stable pageId — typically the URL pathname.
//
// Cursors are anchored to this element. Position it `relative` (this
// wrapper enforces that) so the absolutely-positioned cursor layer sits
// on top of the whole content area.
//
// Also renders a `<PageLockBanner>` at the top when the local user
// isn't the head of the room — a lightweight visual cue that some other
// user "owns" the mutating actions on this page. Individual mutating
// buttons still need their own leadership check to actually block the
// click.

import { useRef, type ReactNode } from "react";
import { PageCursors } from "@/components/realtime/page-cursors";
import { PageLockBanner } from "@/components/realtime/page-lock-banner";
import { usePageLeadership } from "@/components/realtime/page-lock-guard";
import { cn } from "@/lib/utils";

interface Props {
  pageId: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  /** When true, skip rendering the shared PageLockBanner at the top —
   *  useful when the page has no mutating actions and the banner would
   *  just confuse readers. */
  suppressBanner?: boolean;
}

export function PageCursorAnchor({
  pageId,
  children,
  className,
  disabled = false,
  suppressBanner = false,
}: Props) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const { isLeader, leader } = usePageLeadership(pageId, disabled);
  const showBanner = !disabled && !suppressBanner && !isLeader && !!leader;
  return (
    <div ref={anchorRef} className={cn("relative", className)}>
      <PageCursors pageId={pageId} anchorRef={anchorRef} disabled={disabled} />
      {showBanner && <PageLockBanner leader={leader} />}
      {children}
    </div>
  );
}
