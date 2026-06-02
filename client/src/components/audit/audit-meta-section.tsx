import { UserAvatar } from "@/components/users/user-avatar";
import { Calendar, UserCircle2 } from "lucide-react";
import type { AuditActor } from "@/lib/types";

interface AuditMetaSectionProps {
  inserted_at: string | null | undefined;
  updated_at?: string | null;
  created_by?: AuditActor | null;
  updated_by?: AuditActor | null;
}

/**
 * "Who created · who last touched" strip shown at the bottom of every
 * detail page. Two rows: one for creation, one for the most recent
 * update. Falls back to "Unknown" when the actor was deleted before
 * we started capturing audit snapshots.
 *
 * Pair with `<AuditHistoryCard>` when full per-field history is
 * available (warehouses, templates, user-access).
 */
export function AuditMetaSection({
  inserted_at,
  updated_at,
  created_by,
  updated_by,
}: AuditMetaSectionProps) {
  const showUpdate =
    updated_at &&
    updated_at !== inserted_at &&
    (updated_by || inserted_at !== updated_at);

  return (
    <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
        Ownership
      </p>
      <div className="space-y-1.5">
        <MetaRow
          icon={Calendar}
          label="Created"
          at={inserted_at}
          by={created_by}
        />
        {showUpdate && (
          <MetaRow
            icon={UserCircle2}
            label="Last updated"
            at={updated_at}
            by={updated_by ?? created_by}
          />
        )}
      </div>
    </div>
  );
}

function MetaRow({
  icon: Icon,
  label,
  at,
  by,
}: {
  icon: typeof Calendar;
  label: string;
  at: string | null | undefined;
  by?: AuditActor | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Icon className="size-3 shrink-0 text-muted-foreground/60" />
      <span className="font-medium text-foreground">{label}</span>
      {at && <span>· {new Date(at).toLocaleString()}</span>}
      {by && (
        <span className="inline-flex items-center gap-1">
          <span>by</span>
          <UserAvatar
            name={by.name}
            email={by.email}
            avatar={by.avatar}
            sizeClassName="size-4"
            fallbackClassName="text-[8px]"
          />
          <span className="font-medium text-foreground">{by.name}</span>
        </span>
      )}
      {!by && at && <span className="italic">· author unknown</span>}
    </div>
  );
}
