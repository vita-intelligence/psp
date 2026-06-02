"use client";

import { UserAvatar } from "@/components/users/user-avatar";
import { cn } from "@/lib/utils";
import type { CollabPeer } from "@/lib/realtime/use-live-form";
import { Users } from "lucide-react";

interface CollabAvatarsProps {
  peers: CollabPeer[];
  /** Max avatars shown before collapsing into "+N". Default 4. */
  max?: number;
  className?: string;
}

/**
 * Stack of overlapping avatars showing who else is on this form right
 * now. Hover any avatar to see the person's name and which field
 * they're editing (if any).
 *
 * Empty state shows nothing — when only you are on the form there's no
 * value in saying "nobody else here".
 */
export function CollabAvatars({
  peers,
  max = 4,
  className,
}: CollabAvatarsProps) {
  if (peers.length === 0) return null;

  const shown = peers.slice(0, max);
  const overflow = peers.length - shown.length;

  return (
    <div
      className={cn("flex items-center gap-2", className)}
      title={`${peers.length} other ${peers.length === 1 ? "person" : "people"} editing now`}
    >
      <Users className="size-3.5 text-muted-foreground" />
      <div className="flex -space-x-2">
        {shown.map((p) => (
          <div
            key={p.id}
            title={
              p.focusField
                ? `${p.name} — editing ${p.focusField}`
                : p.name
            }
            className="relative"
          >
            <UserAvatar
              name={p.name}
              email={p.email}
              avatar={p.avatar}
              sizeClassName="size-7"
              fallbackClassName="text-[10px]"
              className="ring-2 ring-background"
            />
          </div>
        ))}
        {overflow > 0 && (
          <span className="z-10 inline-flex size-7 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground ring-2 ring-background">
            +{overflow}
          </span>
        )}
      </div>
    </div>
  );
}
