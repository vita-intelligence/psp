"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { DataTable } from "@/components/data-table";
import type {
  DataTableColumn,
  PageResult,
  SortSpec,
} from "@/components/data-table";
import { Badge } from "@/components/ui/badge-mini";
import { auditColumns } from "@/components/audit/audit-table-columns";
import type { StorageTag } from "@/lib/types";

interface StorageTagsTableProps {
  initialPage: PageResult<StorageTag>;
}

const DEFAULT_SORT: SortSpec = { field: "label", direction: "asc" };

const KIND_TONE: Record<StorageTag["kind"], "muted" | "amber" | "indigo"> = {
  both: "muted",
  location: "amber",
  cell: "indigo",
};

const KIND_LABEL: Record<StorageTag["kind"], string> = {
  both: "Both",
  location: "Racks / zones",
  cell: "Shelves / levels",
};

async function fetchTagsPage(params: {
  cursor: string | null;
  limit: number;
  sort: SortSpec | null;
  filters: Record<string, string | boolean | number>;
  search: string;
}): Promise<PageResult<StorageTag>> {
  const qs = new URLSearchParams();
  qs.set("limit", String(params.limit));
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.sort)
    qs.set("sort", `${params.sort.field}:${params.sort.direction}`);
  if (params.search) qs.set("search", params.search);

  const res = await fetch(`/api/storage-tags?${qs.toString()}`, {
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
  return (await res.json()) as PageResult<StorageTag>;
}

export function StorageTagsTable({ initialPage }: StorageTagsTableProps) {
  const router = useRouter();

  const columns = useMemo<DataTableColumn<StorageTag>[]>(
    () => [
      {
        id: "code",
        header: "Code",
        sortField: "code",
        sortLabels: { asc: "A → Z", desc: "Z → A" },
        widthClassName: "w-28",
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
        id: "key",
        header: "Key",
        sortField: "key",
        sortLabels: { asc: "A → Z", desc: "Z → A" },
        widthClassName: "w-44",
        cell: (t) => (
          <span className="font-mono text-xs text-muted-foreground">
            {t.key}
          </span>
        ),
      },
      {
        id: "label",
        header: "Label",
        sortField: "label",
        sortLabels: { asc: "A → Z", desc: "Z → A" },
        hideable: false,
        widthClassName: "min-w-[14rem]",
        cell: (t) => <span className="truncate font-medium">{t.label}</span>,
      },
      {
        id: "kind",
        header: "Applies to",
        sortField: "kind",
        sortLabels: { asc: "Both first", desc: "Cell first" },
        widthClassName: "w-44",
        cell: (t) => (
          <Badge tone={KIND_TONE[t.kind]}>{KIND_LABEL[t.kind]}</Badge>
        ),
      },
      {
        id: "description",
        header: "Description",
        widthClassName: "min-w-[16rem]",
        cell: (t) =>
          t.description ? (
            <span className="line-clamp-1 text-sm text-muted-foreground">
              {t.description}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      ...auditColumns<StorageTag>(),
    ],
    [],
  );

  return (
    <DataTable
      tableId="storage-tags"
      columns={columns}
      rowKey={(t) => String(t.id)}
      fetchPage={fetchTagsPage}
      initialPage={initialPage}
      searchPlaceholder="Search by code, key, label or description…"
      defaultSort={DEFAULT_SORT}
      onRowClick={(t) => router.push(`/settings/storage-tags/${t.uuid}`)}
      emptyState={
        <div className="space-y-1">
          <p className="text-sm font-medium">No storage tags yet</p>
          <p className="text-xs text-muted-foreground">
            Add the vocabulary your warehouse uses — common starters:{" "}
            <span className="font-mono">pallet</span>,{" "}
            <span className="font-mono">cold-zone</span>,{" "}
            <span className="font-mono">hazmat-3</span>,{" "}
            <span className="font-mono">picking</span>.
          </p>
        </div>
      }
    />
  );
}
