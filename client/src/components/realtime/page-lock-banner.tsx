"use client";

// Banner shown to non-leaders on a page whose actions are gated by
// head-of-room lock. Explains WHY the buttons are disabled + names the
// person who currently holds the lock.

import { UserAvatar } from "@/components/users/user-avatar";
import { Lock } from "lucide-react";
import type { CollabPeer } from "@/lib/realtime/use-page-presence";
import { cn } from "@/lib/utils";

interface Props {
  leader: CollabPeer | null;
  className?: string;
}

export function PageLockBanner({ leader, className }: Props) {
  if (!leader) return null;

  return (
    <div
      role="status"
      className={cn(
        "flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-xs text-amber-900 dark:text-amber-200",
        className,
      )}
    >
      <Lock className="size-3.5 shrink-0" aria-hidden />
      <UserAvatar
        name={leader.name}
        email={leader.email}
        avatar={leader.avatar}
        sizeClassName="size-5"
        fallbackClassName="text-[9px]"
      />
      <span className="min-w-0 flex-1">
        <span className="font-semibold">{leader.name}</span> got here first —
        they can act on this page until they leave. You can still read and
        comment.
      </span>
    </div>
  );
}
