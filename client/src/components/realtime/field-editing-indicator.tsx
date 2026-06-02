"use client";

import { UserAvatar } from "@/components/users/user-avatar";
import { cn } from "@/lib/utils";
import type { CollabPeer } from "@/lib/realtime/use-live-form";

interface FieldEditingIndicatorProps {
  peer: CollabPeer | null;
  className?: string;
}

/**
 * Small badge that overlays on an input when a remote peer is editing
 * the same field. Rendered as an absolutely-positioned avatar at the
 * top-right of the input wrapper.
 *
 * Wrap the input in `relative` for this to anchor correctly:
 *
 *   <div className="relative">
 *     <Input … />
 *     <FieldEditingIndicator peer={fieldEditors.name} />
 *   </div>
 */
export function FieldEditingIndicator({
  peer,
  className,
}: FieldEditingIndicatorProps) {
  if (!peer) return null;

  return (
    <span
      title={`${peer.name} is editing`}
      className={cn(
        "pointer-events-none absolute -top-2 -right-2 z-10",
        className,
      )}
    >
      <span className="relative inline-flex">
        <UserAvatar
          name={peer.name}
          email={peer.email}
          avatar={peer.avatar}
          sizeClassName="size-6"
          fallbackClassName="text-[10px]"
          className="ring-2 ring-background"
        />
        <span className="absolute -bottom-0.5 -right-0.5 inline-flex size-2 rounded-full bg-emerald-500 ring-2 ring-background" />
      </span>
    </span>
  );
}
