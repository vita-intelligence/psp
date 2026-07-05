"use client";

// Wrapper that disables its children (buttons, forms) when the local
// user isn't the head of the page room. Any button inside becomes
// `disabled + title="…"`; onClick handlers still get bound but the
// browser blocks them via the disabled attribute.
//
// Detail-page action bars wrap their whole action row in this. The
// non-leader user sees the buttons as visibly inert but still visible
// so they know the actions exist.

import type { ReactNode } from "react";
import { usePagePresence } from "@/lib/realtime/use-page-presence";
import { cn } from "@/lib/utils";

interface Props {
  pageId: string;
  children: ReactNode;
  /** Skip the lock entirely — e.g. for viewers who can't act anyway. */
  disabled?: boolean;
  className?: string;
}

/** Guarded wrapper. Adds `[&_button]:disabled` styles when locked, so
 *  every button inside dims. Consumer buttons should also read the
 *  `isLeader` value from `usePageLeadership` to actually block their
 *  click handler — CSS-disabled isn't enough for keyboard-driven
 *  users. See PageLockGuardContext for the JS gate. */
export function PageLockGuard({
  pageId,
  children,
  disabled = false,
  className,
}: Props) {
  const { isLeader, peers } = usePagePresence({ pageId, disabled });
  // If we're solo on the page, no lock. If we're the leader, no lock.
  const locked = !disabled && !isLeader && peers.length > 0;

  return (
    <div
      data-page-locked={locked ? "true" : undefined}
      className={cn(
        locked && "opacity-60 [&_button:not([data-lock-exempt])]:pointer-events-none",
        className,
      )}
      title={locked ? "Only the head of the room can act here." : undefined}
    >
      {children}
    </div>
  );
}

/** Simple hook returning whether the local user has leadership. Use
 *  in action handlers to bail early:
 *
 *      const isLeader = usePageLeadership(pageId);
 *      const handleApprove = () => {
 *        if (!isLeader) return;
 *        // ... hit API
 *      };
 */
export function usePageLeadership(
  pageId: string,
  disabled = false,
): { isLeader: boolean; leader: ReturnType<typeof usePagePresence>["leader"] } {
  const { isLeader, leader } = usePagePresence({ pageId, disabled });
  return { isLeader, leader };
}
