"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Lock, Pencil } from "lucide-react";
import { usePresence } from "@/lib/realtime/presence-store";
import { UserAvatar } from "@/components/users/user-avatar";
import { Button } from "@/components/ui/button";
import { MAX_COLLABORATORS } from "@/lib/realtime/use-live-form";

interface ActiveEditor {
  userId: string;
  name: string;
  email: string;
  avatar?: string | null;
  /** Full `current_form` string from the peer's presence meta — e.g.
   *  `"vendor:abc"`, `"vendor:new"`. */
  current_form: string;
}

interface ActiveSessionsBannerProps {
  /** Current user's id — excluded from the indicators. */
  currentUserId: number;
  /** Resource family prefix that anchors which peers we surface, e.g.
   *  `"vendor"`, `"item"`, `"unit-of-measurement"`. The banner filters
   *  presence by `current_form.startsWith(\`${resourcePrefix}:\`)`. */
  resourcePrefix: string;
  /** Route to the create page, e.g. `/procurement/vendors/new`. */
  newRoute: string;
  /** Human label for the new resource ("vendor", "item", …). */
  resourceLabel: string;
  /** Whether the local user has the perm to join the new-resource form. */
  canCreate: boolean;
}

/**
 * Top-of-list banner showing "X is drafting a new {resource}" with a
 * Join CTA. Reads lobby presence; renders nothing when no peer is on
 * the `:new` form for this resource family.
 */
export function ActiveSessionsBanner({
  currentUserId,
  resourcePrefix,
  newRoute,
  resourceLabel,
  canCreate,
}: ActiveSessionsBannerProps) {
  const editors = useEditorsForPrefix(currentUserId, resourcePrefix);
  const draftEditors = editors.filter(
    (e) => e.current_form === `${resourcePrefix}:new`,
  );

  if (draftEditors.length === 0) return null;

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
          <p className="text-sm font-medium">
            {summary(draftEditors, resourceLabel)}
          </p>
          <p className="text-xs text-muted-foreground">
            {atCapacity
              ? `Form is at capacity (${MAX_COLLABORATORS}/${MAX_COLLABORATORS}).`
              : `Live form — ${projected}/${MAX_COLLABORATORS} spots${canCreate ? " if you join" : ""}.`}
          </p>
        </div>
      </div>
      {canCreate ? (
        <Button asChild size="sm" variant="outline" disabled={atCapacity}>
          <Link href={newRoute}>
            <Pencil className="mr-1.5 size-3.5" />
            {atCapacity ? "Full" : "Join draft"}
          </Link>
        </Button>
      ) : (
        <span
          className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground"
          title={`You need the right permission to join.`}
        >
          <Lock className="size-3" />
          Read-only
        </span>
      )}
    </div>
  );
}

function summary(peers: ActiveEditor[], label: string): string {
  if (peers.length === 1)
    return `${peers[0]!.name} is drafting a new ${label}`;
  if (peers.length === 2)
    return `${peers[0]!.name} and ${peers[1]!.name} are drafting a new ${label}`;
  return `${peers[0]!.name} and ${peers.length - 1} others are drafting a new ${label}`;
}

/**
 * Reads lobby presence + returns peers whose `current_form` starts with
 * `<resourcePrefix>:`. Self-excluded.
 */
export function useEditorsForPrefix(
  currentUserId: number,
  resourcePrefix: string,
): ActiveEditor[] {
  const byUserId = usePresence((s) => s.byUserId);
  return useMemo(() => {
    const out: ActiveEditor[] = [];
    for (const [userId, entry] of Object.entries(byUserId)) {
      if (Number(userId) === currentUserId) continue;
      const meta = entry.metas[0];
      if (!meta?.current_form) continue;
      if (!meta.current_form.startsWith(`${resourcePrefix}:`)) continue;
      out.push({
        userId,
        name: meta.name,
        email: meta.email,
        avatar: meta.avatar ?? null,
        current_form: meta.current_form,
      });
    }
    return out;
  }, [byUserId, currentUserId, resourcePrefix]);
}

interface EditorsBadgeProps {
  /** Full resource string — `"vendor:abc-uuid"`, `"item:42"`, etc. */
  resource: string;
  currentUserId: number;
}

/**
 * Per-row avatar stack + pulsing dot. Mirrors `WarehouseEditorsBadge`
 * but takes an explicit resource string instead of building it from a
 * uuid + hard-coded "warehouse:" prefix.
 */
export function EditorsBadge({
  resource,
  currentUserId,
}: EditorsBadgeProps) {
  const [prefix] = resource.split(":");
  const editors = useEditorsForPrefix(currentUserId, prefix ?? "").filter(
    (e) => e.current_form === resource,
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
