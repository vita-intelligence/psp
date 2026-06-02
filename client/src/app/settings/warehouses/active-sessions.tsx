"use client";

import Link from "next/link";
import { useMemo } from "react";
import { usePresence } from "@/lib/realtime/presence-store";
import { UserAvatar } from "@/components/users/user-avatar";
import { Button } from "@/components/ui/button";
import { MAX_COLLABORATORS } from "@/lib/realtime/use-live-form";
import { Lock, Pencil } from "lucide-react";

interface ActiveEditor {
  userId: string;
  name: string;
  email: string;
  avatar?: string | null;
  /** `"warehouse:42"` or `"warehouse:new"`. */
  current_form: string;
}

interface ActiveSessionsProps {
  /** Current user's id — we exclude ourselves from the indicators. */
  currentUserId: number;
  /** Whether the local user can actually join — controls the Join button. */
  canCreate: boolean;
}

/**
 * Reads lobby presence and surfaces two kinds of indicators on the
 * warehouses list:
 *
 *   1. A "Drafting new warehouse" banner at the top when one or more
 *      peers are on `/settings/warehouses/new` — with a "Join" CTA.
 *   2. Avatar overlays per-warehouse card, rendered as a portal-ish
 *      lookup that the list page's `WarehouseCardOverlay` consumes.
 *
 * This component only renders the top banner; per-card overlays use
 * the exported `useActiveEditors` hook.
 */
export function ActiveSessionsBanner({
  currentUserId,
  canCreate,
}: ActiveSessionsProps) {
  const editors = useActiveEditors(currentUserId);
  const draftEditors = editors.filter(
    (e) => e.current_form === "warehouse:new",
  );

  if (draftEditors.length === 0) return null;

  // +1 because we (the local user) would take the next slot if we
  // joined — that's the slot the button promises.
  const projected = draftEditors.length + (canCreate ? 1 : 0);
  const atCapacity = draftEditors.length >= MAX_COLLABORATORS;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-brand/30 bg-brand/[0.06] px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="flex -space-x-2">
          {draftEditors.slice(0, 3).map((p) => (
            <UserAvatar
              key={p.userId}
              name={p.name}
              email={p.email}
              avatar={p.avatar}
              sizeClassName="size-7"
              fallbackClassName="text-[10px]"
              className="ring-2 ring-background"
            />
          ))}
          {draftEditors.length > 3 && (
            <span className="z-10 inline-flex size-7 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground ring-2 ring-background">
              +{draftEditors.length - 3}
            </span>
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium">{summary(draftEditors)}</p>
          <p className="text-xs text-muted-foreground">
            {atCapacity
              ? `Form is at capacity (${MAX_COLLABORATORS}/${MAX_COLLABORATORS}).`
              : `Live form — ${projected}/${MAX_COLLABORATORS} spots${canCreate ? " if you join" : ""}.`}
          </p>
        </div>
      </div>
      {canCreate ? (
        <Button
          asChild
          size="sm"
          variant="outline"
          disabled={atCapacity}
        >
          <Link href="/settings/warehouses/new">
            <Pencil className="mr-1.5 size-3.5" />
            {atCapacity ? "Full" : "Join draft"}
          </Link>
        </Button>
      ) : (
        <span
          className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground"
          title="You need the warehouses.create permission to join."
        >
          <Lock className="size-3" />
          Read-only
        </span>
      )}
    </div>
  );
}

function summary(peers: ActiveEditor[]): string {
  if (peers.length === 1) return `${peers[0]!.name} is drafting a new warehouse`;
  if (peers.length === 2)
    return `${peers[0]!.name} and ${peers[1]!.name} are drafting a new warehouse`;
  return `${peers[0]!.name} and ${peers.length - 1} others are drafting a new warehouse`;
}

/**
 * Lookup hook — returns the active editors for a specific warehouse
 * (or for `"warehouse:new"`). Use this to render avatar overlays on
 * each warehouse card.
 */
export function useActiveEditors(currentUserId: number): ActiveEditor[] {
  const byUserId = usePresence((s) => s.byUserId);

  return useMemo(() => {
    const out: ActiveEditor[] = [];
    for (const [userId, entry] of Object.entries(byUserId)) {
      if (Number(userId) === currentUserId) continue;
      const meta = entry.metas[0];
      if (!meta?.current_form) continue;
      if (!meta.current_form.startsWith("warehouse:")) continue;
      out.push({
        userId,
        name: meta.name,
        email: meta.email,
        avatar: meta.avatar ?? null,
        current_form: meta.current_form,
      });
    }
    return out;
  }, [byUserId, currentUserId]);
}

interface WarehouseEditorsBadgeProps {
  warehouseId: number;
  currentUserId: number;
}

/**
 * Avatar stack for a single warehouse row. Shows up to 3 small avatars
 * overlapping, with a "+N" pill for overflow and a tiny pulsing green
 * dot signalling "live edit happening". Hovering reveals the full
 * roster via title attribute. Renders nothing when nobody else is in
 * this warehouse's room.
 */
export function WarehouseEditorsBadge({
  warehouseId,
  currentUserId,
}: WarehouseEditorsBadgeProps) {
  const editors = useActiveEditors(currentUserId).filter(
    (e) => e.current_form === `warehouse:${warehouseId}`,
  );

  if (editors.length === 0) return null;

  const shown = editors.slice(0, 3);
  const overflow = editors.length - shown.length;
  const tooltip =
    editors.map((e) => e.name).join(", ") +
    (editors.length === 1 ? " is editing" : " are editing");

  return (
    <span
      className="inline-flex items-center gap-1.5"
      title={tooltip}
      aria-label={tooltip}
    >
      <span className="relative inline-flex size-2 items-center justify-center">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400/60" />
        <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
      </span>
      <span className="flex -space-x-1.5">
        {shown.map((p) => (
          <UserAvatar
            key={p.userId}
            name={p.name}
            email={p.email}
            avatar={p.avatar}
            sizeClassName="size-5"
            fallbackClassName="text-[9px]"
            className="ring-2 ring-background"
          />
        ))}
        {overflow > 0 && (
          <span className="z-10 inline-flex size-5 items-center justify-center rounded-full bg-muted text-[9px] font-semibold text-muted-foreground ring-2 ring-background">
            +{overflow}
          </span>
        )}
      </span>
    </span>
  );
}
