import { UserAvatar } from "@/components/users/user-avatar";
import type { DataTableColumn } from "@/components/data-table";
import type { AuditActor } from "@/lib/types";

/** Records the audit fields must expose so the helper can read them. */
interface Auditable {
  inserted_at: string;
  updated_at?: string | null;
  created_by?: AuditActor | null;
  updated_by?: AuditActor | null;
}

/**
 * Four audit columns the DataTable can mix into any audited entity's
 * column list. All hideable + hidden by default (`hidden: true`) so
 * the table stays clean; users opt in from the Columns menu when they
 * want to see them.
 *
 * `inserted_at` / `updated_at` are also sortable via the backend's
 * `inserted_at` whitelist (warehouses + templates already include
 * it; users does too via @sortable_fields).
 */
export function auditColumns<T extends Auditable>(): DataTableColumn<T>[] {
  return [
    {
      id: "created_at",
      header: "Created at",
      sortField: "inserted_at",
      sortLabels: { asc: "Oldest first", desc: "Newest first" },
      defaultHidden: true,
      widthClassName: "w-36",
      cell: (row) => <DateCell value={row.inserted_at} />,
    },
    {
      id: "created_by",
      header: "Created by",
      defaultHidden: true,
      widthClassName: "min-w-[10rem]",
      cell: (row) => <ActorCell actor={row.created_by ?? null} />,
    },
    {
      id: "updated_at",
      header: "Updated at",
      defaultHidden: true,
      widthClassName: "w-36",
      cell: (row) => <DateCell value={row.updated_at} />,
    },
    {
      id: "updated_by",
      header: "Updated by",
      defaultHidden: true,
      widthClassName: "min-w-[10rem]",
      cell: (row) => <ActorCell actor={row.updated_by ?? null} />,
    },
  ];
}

function DateCell({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-xs text-muted-foreground/50">—</span>;
  return (
    <span className="text-xs text-muted-foreground">
      {new Date(value).toLocaleDateString()}
    </span>
  );
}

function ActorCell({ actor }: { actor: AuditActor | null }) {
  if (!actor) return <span className="text-xs text-muted-foreground/50">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <UserAvatar
        name={actor.name}
        email={actor.email}
        avatar={actor.avatar}
        sizeClassName="size-5"
        fallbackClassName="text-[9px]"
      />
      <span className="truncate text-xs text-foreground">{actor.name}</span>
    </span>
  );
}
