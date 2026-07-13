"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { DataTable } from "@/components/data-table";
import type {
  ColumnFilterValue,
  DataTableColumn,
  FilterDef,
  PageResult,
  SortSpec,
} from "@/components/data-table";
import { serializeColumnFilters } from "@/lib/data-table/serialize";
import { UserAvatar } from "@/components/users/user-avatar";
import { Badge } from "@/components/ui/badge-mini";
import { auditColumns } from "@/components/audit/audit-table-columns";
import type { UserListEntry } from "@/lib/types";

interface UsersTableProps {
  initialPage: PageResult<UserListEntry>;
}

const FILTERS: FilterDef[] = [
  {
    field: "is_active",
    label: "Status",
    options: [
      { label: "Active", value: true },
      { label: "Inactive", value: false },
    ],
  },
];

const DEFAULT_SORT: SortSpec = { field: "name", direction: "asc" };

async function fetchUsersPage(params: {
  cursor: string | null;
  limit: number;
  sort: SortSpec | null;
  filters: Record<string, string | boolean | number>;
  columnFilters: Record<string, ColumnFilterValue>;
  search: string;
}): Promise<PageResult<UserListEntry>> {
  const qs = new URLSearchParams();
  qs.set("limit", String(params.limit));
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.sort)
    qs.set("sort", `${params.sort.field}:${params.sort.direction}`);
  if (params.search) qs.set("search", params.search);
  for (const [k, v] of Object.entries(params.filters)) {
    qs.set(`filter[${k}]`, String(v));
  }
  serializeColumnFilters(qs, params.columnFilters);

  const res = await fetch(`/api/users?${qs.toString()}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { detail?: string };
      if (body?.detail) detail = body.detail;
    } catch {
      /* leave detail */
    }
    throw new Error(detail);
  }
  return (await res.json()) as PageResult<UserListEntry>;
}

export function UsersTable({ initialPage }: UsersTableProps) {
  const router = useRouter();

  const columns = useMemo<DataTableColumn<UserListEntry>[]>(
    () => [
      {
        id: "code",
        header: "Code",
        sortField: "code",
        sortLabels: { asc: "A → Z", desc: "Z → A" },
        widthClassName: "w-24",
        filterField: "code",
        filterKind: "text",
        filterPlaceholder: "U00001…",
        group: "Identity",
        description: "Auto-numbered user code (U00001, …).",
        cell: (u) =>
          u.code ? (
            <span className="font-mono text-xs text-muted-foreground">
              {u.code}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "person",
        header: "Name",
        sortField: "name",
        sortLabels: { asc: "A → Z", desc: "Z → A" },
        hideable: false,
        widthClassName: "min-w-[16rem]",
        filterField: "name",
        filterKind: "text",
        filterPlaceholder: "Name…",
        group: "Identity",
        description: "Full name shown across the app.",
        cell: (u) => (
          <div className="flex items-center gap-2.5">
            <div className="relative shrink-0">
              <UserAvatar
                name={u.name}
                email={u.email}
                avatar={u.avatar}
                sizeClassName="size-8"
                fallbackClassName="text-xs"
              />
              {u.is_online && (
                <span
                  aria-label="Online"
                  className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full border-2 border-background bg-emerald-500"
                />
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{u.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {u.email}
              </p>
            </div>
          </div>
        ),
      },
      {
        id: "admin",
        header: "Admin",
        widthClassName: "w-24",
        group: "Compliance",
        description: "Whether this user has the platform-admin short-circuit.",
        cell: (u) =>
          u.is_admin ? (
            <Badge tone="brand">Admin</Badge>
          ) : (
            <span className="text-xs text-muted-foreground/60">—</span>
          ),
      },
      {
        id: "status",
        header: "Status",
        sortField: "is_active",
        sortLabels: { asc: "Inactive first", desc: "Active first" },
        widthClassName: "w-28",
        filterField: "is_active",
        filterKind: "boolean",
        group: "Status",
        description: "Whether the account is enabled.",
        cell: (u) => (
          <Badge tone={u.is_active ? "emerald" : "muted"}>
            {u.is_active ? "Active" : "Inactive"}
          </Badge>
        ),
      },
      // ---- defaultHidden columns below ----
      {
        id: "email",
        header: "Email",
        widthClassName: "min-w-[14rem]",
        defaultHidden: true,
        sortField: "email",
        sortLabels: { asc: "A → Z", desc: "Z → A" },
        filterField: "email",
        filterKind: "text",
        filterPlaceholder: "email@vitamanufacture.co.uk",
        group: "Identity",
        description: "Login email.",
        cell: (u) => (
          <span className="truncate text-xs text-muted-foreground">
            {u.email}
          </span>
        ),
      },
      {
        id: "is_online",
        header: "Online",
        widthClassName: "w-20",
        defaultHidden: true,
        group: "Meta",
        description: "Live presence flag (from the presence tracker).",
        cell: (u) => (
          <Badge tone={u.is_online ? "emerald" : "muted"}>
            {u.is_online ? "Online" : "Offline"}
          </Badge>
        ),
      },
      {
        id: "is_admin",
        header: "Admin",
        widthClassName: "w-24",
        defaultHidden: true,
        group: "Compliance",
        description: "Platform-admin short-circuits every permission check.",
        cell: (u) => (
          <Badge tone={u.is_admin ? "brand" : "muted"}>
            {u.is_admin ? "Admin" : "Standard"}
          </Badge>
        ),
      },
      {
        id: "permissions_count",
        header: "Permissions",
        widthClassName: "w-28",
        align: "right",
        defaultHidden: true,
        group: "Compliance",
        description: "How many direct-grant permission codes this user holds.",
        cell: (u) => (
          <span className="font-mono text-xs">
            {u.permissions?.length ?? 0}
          </span>
        ),
      },
      {
        id: "confirmed_at",
        header: "Confirmed",
        widthClassName: "w-32",
        defaultHidden: true,
        group: "Compliance",
        description: "Whether the account has confirmed its email.",
        cell: (u) => (
          <Badge tone={u.confirmed_at ? "emerald" : "amber"}>
            {u.confirmed_at ? "Yes" : "Pending"}
          </Badge>
        ),
      },
      ...auditColumns<UserListEntry>(),
    ],
    [],
  );

  return (
    <DataTable<UserListEntry>
      tableId="users"
      realtimeEntity="user"
      columns={columns}
      rowKey={(u) => String(u.id)}
      fetchPage={fetchUsersPage}
      initialPage={initialPage}
      defaultSort={DEFAULT_SORT}
      searchPlaceholder="Search by name or email…"
      filters={FILTERS}
      onRowClick={(u) => router.push(`/settings/users/${u.uuid}`)}
      renderMobileCard={(u) => (
        <div className="space-y-2">
          <div className="flex items-start gap-3">
            <div className="relative shrink-0">
              <UserAvatar
                name={u.name}
                email={u.email}
                avatar={u.avatar}
                sizeClassName="size-10"
                fallbackClassName="text-sm"
              />
              {u.is_online && (
                <span
                  aria-label="Online"
                  className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background bg-emerald-500"
                />
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="truncate text-sm font-semibold">{u.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {u.email}
              </p>
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <Badge tone={u.is_active ? "emerald" : "muted"}>
                  {u.is_active ? "Active" : "Inactive"}
                </Badge>
                {u.is_admin && <Badge tone="brand">Admin</Badge>}
              </div>
            </div>
          </div>
        </div>
      )}
      emptyState={
        <div className="space-y-1">
          <p className="text-sm font-medium">No users yet</p>
          <p className="text-xs text-muted-foreground">
            Invite teammates to join your company.
          </p>
        </div>
      }
    />
  );
}
