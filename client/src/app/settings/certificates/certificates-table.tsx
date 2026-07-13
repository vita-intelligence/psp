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
import { auditColumns } from "@/components/audit/audit-table-columns";
import type { Certificate, CertificateType } from "@/lib/types";

const DEFAULT_SORT: SortSpec = { field: "name", direction: "asc" };

const TYPE_LABEL: Record<CertificateType, string> = {
  organic: "Organic",
  halal: "Halal",
  kosher: "Kosher",
  iso_22000: "ISO 22000",
  brc: "BRC",
  fssc_22000: "FSSC 22000",
  gmp: "GMP",
  ifs: "IFS",
  haccp: "HACCP",
  usda_organic: "USDA Organic",
  non_gmo_project: "Non-GMO Project",
  other: "Other",
};

const TYPE_OPTIONS = (
  Object.keys(TYPE_LABEL) as CertificateType[]
).map((t) => ({ label: TYPE_LABEL[t], value: t }));

async function fetchPage(params: {
  cursor: string | null;
  limit: number;
  sort: SortSpec | null;
  filters: Record<string, string | boolean | number>;
  columnFilters: Record<string, ColumnFilterValue>;
  search: string;
}): Promise<PageResult<Certificate>> {
  const qs = new URLSearchParams();
  qs.set("limit", String(params.limit));
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.sort)
    qs.set("sort", `${params.sort.field}:${params.sort.direction}`);
  if (params.search) qs.set("search", params.search);
  serializeColumnFilters(qs, params.columnFilters);

  const res = await fetch(`/api/certificates?${qs.toString()}`, {
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
  return (await res.json()) as PageResult<Certificate>;
}

export function CertificatesTable({
  initialPage,
}: {
  initialPage: PageResult<Certificate>;
}) {
  const router = useRouter();

  const columns = useMemo<DataTableColumn<Certificate>[]>(
    () => [
      {
        id: "code",
        header: "Code",
        sortField: "code",
        sortLabels: { asc: "A → Z", desc: "Z → A" },
        widthClassName: "w-28",
        filterField: "code",
        filterKind: "text",
        filterPlaceholder: "CT00001…",
        group: "Identity",
        description: "Auto-numbered certificate code.",
        cell: (c) =>
          c.code ? (
            <span className="font-mono text-xs text-muted-foreground">
              {c.code}
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
        widthClassName: "min-w-[16rem]",
        filterField: "name",
        filterKind: "text",
        filterPlaceholder: "Certificate name…",
        group: "Identity",
        description: "Human-readable name of this certificate type.",
        cell: (c) => (
          <div className="flex flex-col">
            <span className="truncate font-medium">{c.name}</span>
            {c.issuing_body && (
              <span className="truncate text-xs text-muted-foreground">
                {c.issuing_body}
              </span>
            )}
          </div>
        ),
      },
      {
        id: "type",
        header: "Type",
        sortField: "certificate_type",
        sortLabels: { asc: "A → Z", desc: "Z → A" },
        widthClassName: "w-36",
        filterField: "certificate_type",
        filterKind: "select",
        filterOptions: TYPE_OPTIONS,
        group: "Identity",
        description: "Certificate scheme (Organic, HACCP, BRC, …).",
        cell: (c) => (
          <Badge tone="indigo">{TYPE_LABEL[c.certificate_type]}</Badge>
        ),
      },
      {
        id: "validity",
        header: "Default validity",
        widthClassName: "w-32",
        sortField: "default_validity_months",
        filterField: "default_validity_months",
        filterKind: "number-range",
        group: "Dates",
        description: "Default validity window in months — seeds new attachments.",
        cell: (c) =>
          c.default_validity_months ? (
            <span className="text-xs text-muted-foreground">
              {c.default_validity_months} months
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
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
        description: "Whether this certificate type is currently active.",
        cell: (c) => (
          <Badge tone={c.is_active ? "emerald" : "muted"}>
            {c.is_active ? "Active" : "Inactive"}
          </Badge>
        ),
      },
      // ---- defaultHidden columns below ----
      {
        id: "issuing_body",
        header: "Issuing body",
        widthClassName: "min-w-[12rem]",
        defaultHidden: true,
        sortField: "issuing_body",
        filterField: "issuing_body",
        filterKind: "text",
        filterPlaceholder: "Issuing body…",
        group: "Identity",
        description: "Body that issues this certificate.",
        cell: (c) =>
          c.issuing_body ? (
            <span className="truncate text-xs">{c.issuing_body}</span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "description",
        header: "Description",
        widthClassName: "min-w-[16rem]",
        defaultHidden: true,
        group: "Meta",
        description: "Free-form description shown on the detail page.",
        cell: (c) =>
          c.description ? (
            <span className="line-clamp-1 text-xs text-muted-foreground">
              {c.description}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      ...auditColumns<Certificate>(),
    ],
    [],
  );

  return (
    <DataTable
      tableId="certificates"
      realtimeEntity="certificate"
      columns={columns}
      rowKey={(c) => String(c.id)}
      fetchPage={fetchPage}
      initialPage={initialPage}
      searchPlaceholder="Search by name, issuing body, description…"
      defaultSort={DEFAULT_SORT}
      onRowClick={(c) => router.push(`/settings/certificates/${c.uuid}`)}
      emptyState={
        <div className="space-y-1">
          <p className="text-sm font-medium">No certificates yet</p>
          <p className="text-xs text-muted-foreground">
            Define the certificate types your company tracks — GMP, Organic,
            Halal, Kosher, ISO 22000, etc.
          </p>
        </div>
      }
    />
  );
}
