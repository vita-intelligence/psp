"use client";

// Avatar stack for the TopBar showing everyone on the current page.
// The leader (earliest joiner) gets a small crown badge so anyone
// glancing at the header can tell who's driving right now.
//
// Wraps `usePagePresence` internally so consumers just pass a pageId
// and the component takes care of channel join / presence sync.

import { UserAvatar } from "@/components/users/user-avatar";
import { cn } from "@/lib/utils";
import { Crown } from "lucide-react";
import { usePagePresence } from "@/lib/realtime/use-page-presence";
import type { CollabPeer } from "@/lib/realtime/use-page-presence";

interface Props {
  pageId: string;
  /** Max avatars shown before collapsing into "+N". Default 4. */
  max?: number;
  /** Skip the channel — useful on pre-auth screens. */
  disabled?: boolean;
  className?: string;
}

export function PagePresenceAvatars({
  pageId,
  max = 4,
  disabled = false,
  className,
}: Props) {
  const { peers, leader } = usePagePresence({ pageId, disabled });

  if (peers.length === 0) return null;

  // Leader first so the crown always sits at the leftmost visible slot.
  // Everyone else in join order.
  const ordered = [...peers].sort((a, b) => {
    if (a.id === leader?.id) return -1;
    if (b.id === leader?.id) return 1;
    return a.joinedAt - b.joinedAt;
  });

  const shown = ordered.slice(0, max);
  const overflow = ordered.length - shown.length;

  return (
    <div
      className={cn("flex items-center", className)}
      title={peerNames(peers)}
    >
      <div className="flex -space-x-2">
        {shown.map((p) => (
          <PeerAvatar
            key={p.id}
            peer={p}
            isLeader={p.id === leader?.id}
          />
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

function PeerAvatar({
  peer,
  isLeader,
}: {
  peer: CollabPeer;
  isLeader: boolean;
}) {
  const viewport =
    peer.viewportW && peer.viewportH
      ? ` · ${peer.viewportW}×${peer.viewportH}`
      : "";
  const label = isLeader
    ? `${peer.name} — head of room${viewport}`
    : `${peer.name}${viewport}`;
  return (
    <div title={label} className="relative">
      <UserAvatar
        name={peer.name}
        email={peer.email}
        avatar={peer.avatar}
        sizeClassName="size-7"
        fallbackClassName="text-[10px]"
        className="ring-2 ring-background"
      />
      {isLeader && (
        <span
          aria-hidden
          className="absolute -bottom-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full bg-amber-500 text-white ring-2 ring-background"
        >
          <Crown className="size-2" />
        </span>
      )}
    </div>
  );
}

function peerNames(peers: CollabPeer[]): string {
  if (peers.length === 1) return `${peers[0].name} is here`;
  const names = peers
    .slice(0, 4)
    .map((p) => p.name)
    .join(", ");
  const overflow = peers.length > 4 ? ` and ${peers.length - 4} more` : "";
  return `${names}${overflow} are on this page`;
}
