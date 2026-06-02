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
  /** `"role:42"` or `"role:new"`. */
  current_form: string;
}

interface ActiveSessionsProps {
  currentUserId: number;
  canCreate: boolean;
}

/**
 * Top-of-list banner that surfaces drafts in progress: when one or
 * more peers are on `/settings/roles/new`, show their avatars + a
 * "Join draft" CTA so admins can hop into the live form together
 * instead of starting parallel templates.
 */
export function TemplateActiveSessionsBanner({
  currentUserId,
  canCreate,
}: ActiveSessionsProps) {
  const editors = useTemplateEditors(currentUserId);
  const draftEditors = editors.filter((e) => e.current_form === "role:new");

  if (draftEditors.length === 0) return null;

  const projected = draftEditors.length + (canCreate ? 1 : 0);
  const atCapacity = draftEditors.length >= MAX_COLLABORATORS;

  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-brand/30 bg-brand/[0.06] px-4 py-3">
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
        <Button asChild size="sm" variant="outline" disabled={atCapacity}>
          <Link href="/settings/roles/new">
            <Pencil className="mr-1.5 size-3.5" />
            {atCapacity ? "Full" : "Join draft"}
          </Link>
        </Button>
      ) : (
        <span
          className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground"
          title="You need the roles.create permission to join."
        >
          <Lock className="size-3" />
          Read-only
        </span>
      )}
    </div>
  );
}

function summary(peers: ActiveEditor[]): string {
  if (peers.length === 1) return `${peers[0]!.name} is drafting a new template`;
  if (peers.length === 2)
    return `${peers[0]!.name} and ${peers[1]!.name} are drafting a new template`;
  return `${peers[0]!.name} and ${peers.length - 1} others are drafting a new template`;
}

/**
 * Per-template active editors lookup. Reads lobby presence and
 * returns the peers whose `current_form` points into the `role:`
 * namespace. Filtered down per-row in `TemplateEditorsBadge`.
 */
function useTemplateEditors(currentUserId: number): ActiveEditor[] {
  const byUserId = usePresence((s) => s.byUserId);

  return useMemo(() => {
    const out: ActiveEditor[] = [];
    for (const [userId, entry] of Object.entries(byUserId)) {
      if (Number(userId) === currentUserId) continue;
      const meta = entry.metas[0];
      if (!meta?.current_form) continue;
      if (!meta.current_form.startsWith("role:")) continue;
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

interface TemplateEditorsBadgeProps {
  /** The template's public UUID — matches the form-channel topic the
   *  edit form broadcasts via `useFormPresenceBeacon`. */
  templateUuid: string;
  currentUserId: number;
}

/**
 * Avatar stack for one template row. Pulsing green dot + up to 3
 * small avatars + "+N" overflow. Tooltip lists everyone editing.
 * Renders nothing when nobody else is in this template's room.
 */
export function TemplateEditorsBadge({
  templateUuid,
  currentUserId,
}: TemplateEditorsBadgeProps) {
  const editors = useTemplateEditors(currentUserId).filter(
    (e) => e.current_form === `role:${templateUuid}`,
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
