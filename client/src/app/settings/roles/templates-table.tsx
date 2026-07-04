"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { DataTable } from "@/components/data-table";
import type {
  ColumnFilterValue,
  DataTableColumn,
  PageResult,
  SortSpec,
} from "@/components/data-table";
import { serializeColumnFilters } from "@/lib/data-table/serialize";
import { Badge } from "@/components/ui/badge-mini";
import { ShieldCheck } from "lucide-react";
import { TemplateEditorsBadge } from "./active-sessions";
import { auditColumns } from "@/components/audit/audit-table-columns";
import type { PermissionTemplate } from "@/lib/types";

interface TemplatesTableProps {
  initialPage: PageResult<PermissionTemplate>;
  currentUserId: number;
  toolbarActions?: React.ReactNode;
  beforeTable?: React.ReactNode;
}

const DEFAULT_SORT: SortSpec = { field: "name", direction: "asc" };

async function fetchTemplatesPage(params: {
  cursor: string | null;
  limit: number;
  sort: SortSpec | null;
  filters: Record<string, string | boolean | number>;
  columnFilters: Record<string, ColumnFilterValue>;
  search: string;
}): Promise<PageResult<PermissionTemplate>> {
  const qs = new URLSearchParams();
  qs.set("limit", String(params.limit));
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.sort)
    qs.set("sort", `${params.sort.field}:${params.sort.direction}`);
  if (params.search) qs.set("search", params.search);
  serializeColumnFilters(qs, params.columnFilters);

  const res = await fetch(`/api/roles?${qs.toString()}`, {
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
  return (await res.json()) as PageResult<PermissionTemplate>;
}

export function TemplatesTable({
  initialPage,
  currentUserId,
  toolbarActions,
  beforeTable,
}: TemplatesTableProps) {
  const router = useRouter();

  const columns = useMemo<DataTableColumn<PermissionTemplate>[]>(
    () => [
      {
        id: "code",
        header: "Code",
        sortField: "code",
        sortLabels: { asc: "A → Z", desc: "Z → A" },
        widthClassName: "w-24",
        filterField: "id",
        filterKind: "text",
        filterPlaceholder: "PT00001…",
        group: "Identity",
        description: "Auto-numbered template code (PT00001, …).",
        cell: (t) =>
          t.code ? (
            <span className="font-mono text-xs text-muted-foreground">
              {t.code}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "name",
        header: "Name",
        sortField: "name",
        sortLabels: { asc: "A → Z", desc: "Z → A" },
        hideable: false,
        widthClassName: "min-w-[14rem]",
        filterField: "name",
        filterKind: "text",
        filterPlaceholder: "Template name…",
        group: "Identity",
        description: "Display name of this permission template.",
        cell: (t) => (
          <div className="flex items-center gap-2">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
              <ShieldCheck className="size-3.5" />
            </div>
            <span className="truncate font-medium">{t.name}</span>
            <TemplateEditorsBadge
              templateUuid={t.uuid}
              currentUserId={currentUserId}
            />
          </div>
        ),
      },
      {
        id: "description",
        header: "Description",
        widthClassName: "min-w-[16rem]",
        filterField: "description",
        filterKind: "text",
        filterPlaceholder: "Description…",
        group: "Meta",
        description: "What the template is for — free-text summary.",
        cell: (t) =>
          t.description ? (
            <span className="line-clamp-1 text-sm text-muted-foreground">
              {t.description}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "permissions",
        header: "Permissions",
        widthClassName: "w-32",
        group: "Compliance",
        description: "How many permission codes this template grants.",
        cell: (t) => (
          <Badge tone="muted">
            {t.permissions.length} perm{t.permissions.length === 1 ? "" : "s"}
          </Badge>
        ),
      },
      // ---- defaultHidden columns below ----
      {
        id: "slug",
        header: "Slug",
        widthClassName: "w-40",
        defaultHidden: true,
        group: "Identity",
        description: "URL/API-safe identifier for this template.",
        cell: (t) => (
          <span className="font-mono text-[11px] text-muted-foreground">
            {t.slug}
          </span>
        ),
      },
      {
        id: "is_system",
        header: "System",
        widthClassName: "w-24",
        defaultHidden: true,
        group: "Compliance",
        description: "System-seeded templates can't be edited or deleted.",
        cell: (t) => (
          <Badge tone={t.is_system ? "sky" : "muted"}>
            {t.is_system ? "System" : "Custom"}
          </Badge>
        ),
      },
      ...auditColumns<PermissionTemplate>(),
    ],
    [currentUserId],
  );

  return (
    <DataTable<PermissionTemplate>
      tableId="templates"
      columns={columns}
      rowKey={(t) => String(t.id)}
      fetchPage={fetchTemplatesPage}
      initialPage={initialPage}
      defaultSort={DEFAULT_SORT}
      searchPlaceholder="Search by name or description…"
      onRowClick={(t) => router.push(`/settings/roles/${t.uuid}`)}
      toolbarActions={toolbarActions}
      beforeTable={beforeTable}
      renderMobileCard={(t) => (
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-1">
              <p className="truncate text-sm font-semibold">{t.name}</p>
              {t.description && (
                <p className="line-clamp-2 text-xs text-muted-foreground">
                  {t.description}
                </p>
              )}
              <Badge tone="muted">
                {t.permissions.length} perm
                {t.permissions.length === 1 ? "" : "s"}
              </Badge>
            </div>
            <TemplateEditorsBadge
              templateUuid={t.uuid}
              currentUserId={currentUserId}
            />
          </div>
        </div>
      )}
      emptyState={
        <div className="space-y-1">
          <p className="text-sm font-medium">No templates yet</p>
          <p className="text-xs text-muted-foreground">
            Templates are optional shortcuts for granting common permission
            combos. The matrix on each user is still the source of truth.
          </p>
        </div>
      }
    />
  );
}
