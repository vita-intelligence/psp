"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronRight,
  LayoutGrid,
  List as ListIcon,
  ShoppingCart,
  Store,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PageResult } from "@/components/data-table";
import type { FormatPrefs } from "@/lib/format/company";
import { formatQtyHumanized } from "@/lib/format/company";
import type {
  ShortageProject,
  ShortageRow,
  ShortageVendorCandidate,
} from "@/lib/procurement-shortages/server";
import { ShortagesTable } from "./shortages-table";

interface Props {
  initialPage: PageResult<ShortageRow>;
  projects: ShortageProject[];
  companyDateFormat: FormatPrefs | null;
}

type ViewMode = "list" | "vendor" | "project";

const UNASSIGNED_KEY = "__unassigned__";

/**
 * Wraps the shortage DataTable with:
 *  * a view-mode segmented control (list / by vendor / by project),
 *  * a project combobox that scopes the whole workspace to one
 *    product (NPD formulation uuid filter — threaded both to the BE
 *    `formulation_uuid` query param and to the client-side grouping
 *    paths so sub-pages agree),
 *  * two alternate renderers: a per-primary-vendor cluster view with
 *    a "Create PO for this vendor" bulk action that deep-links to
 *    the PO wizard with every shortage line already filled in; and
 *    a per-project cluster view that groups by `formulation_uuid`.
 *
 * The flat-list view just reuses the existing DataTable so filters,
 * sort, column pickers, and realtime updates keep working untouched.
 */
export function ShortagesWorkspace({
  initialPage,
  projects,
  companyDateFormat,
}: Props) {
  const [view, setView] = useState<ViewMode>("list");
  const [formulationUuid, setFormulationUuid] = useState<string | null>(null);

  // For the grouped views we need the full result set, not the
  // DataTable's cursor-paginated slice — the clusters have to show
  // every row that belongs under each vendor / project. We fetch
  // the unpaginated feed once per project-filter change.
  const [allRows, setAllRows] = useState<ShortageRow[] | null>(null);
  const [loadingAll, setLoadingAll] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const needsFullFeed = view !== "list";

  const refreshAll = useCallback(async () => {
    setLoadingAll(true);
    setLoadError(null);
    try {
      const qs = new URLSearchParams();
      qs.set("limit", "200");
      qs.set("sort", "shortage_qty:desc");
      if (formulationUuid) qs.set("formulation_uuid", formulationUuid);
      const res = await fetch(`/api/procurement/shortages?${qs.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as PageResult<ShortageRow>;
      setAllRows(body.items ?? []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load");
      setAllRows([]);
    } finally {
      setLoadingAll(false);
    }
  }, [formulationUuid]);

  useEffect(() => {
    if (!needsFullFeed) return;
    if (allRows !== null && !formulationUuid) return;
    void refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsFullFeed, formulationUuid]);

  const selectedProject = useMemo(
    () =>
      formulationUuid
        ? projects.find((p) => p.formulation_uuid === formulationUuid) ?? null
        : null,
    [projects, formulationUuid],
  );

  return (
    <div className="space-y-4">
      <WorkspaceControls
        view={view}
        onView={setView}
        projects={projects}
        formulationUuid={formulationUuid}
        onFormulationUuid={setFormulationUuid}
        selectedProject={selectedProject}
      />

      {view === "list" && (
        <ShortagesTable
          initialPage={formulationUuid ? { items: [], next_cursor: null } : initialPage}
          companyDateFormat={companyDateFormat}
          formulationUuid={formulationUuid}
        />
      )}

      {view === "vendor" && (
        <VendorClusterView
          rows={allRows ?? []}
          loading={loadingAll}
          error={loadError}
          onRetry={refreshAll}
          companyDateFormat={companyDateFormat}
        />
      )}

      {view === "project" && (
        <ProjectClusterView
          rows={allRows ?? []}
          loading={loadingAll}
          error={loadError}
          onRetry={refreshAll}
          onPick={(uuid) => {
            setFormulationUuid(uuid);
            setView("list");
          }}
          companyDateFormat={companyDateFormat}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Controls bar
// ────────────────────────────────────────────────────────────────────

function WorkspaceControls({
  view,
  onView,
  projects,
  formulationUuid,
  onFormulationUuid,
  selectedProject,
}: {
  view: ViewMode;
  onView: (v: ViewMode) => void;
  projects: ShortageProject[];
  formulationUuid: string | null;
  onFormulationUuid: (uuid: string | null) => void;
  selectedProject: ShortageProject | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
      <div className="inline-flex rounded-md border border-border/60 bg-background p-0.5 text-xs">
        <ToggleBtn
          active={view === "list"}
          onClick={() => onView("list")}
          icon={<ListIcon className="size-3.5" />}
          label="List"
        />
        <ToggleBtn
          active={view === "vendor"}
          onClick={() => onView("vendor")}
          icon={<Store className="size-3.5" />}
          label="By vendor"
        />
        <ToggleBtn
          active={view === "project"}
          onClick={() => onView("project")}
          icon={<LayoutGrid className="size-3.5" />}
          label="By project"
        />
      </div>

      <div className="ml-auto flex min-w-0 items-center gap-2">
        <ProjectSelect
          projects={projects}
          value={formulationUuid}
          onChange={onFormulationUuid}
        />
        {selectedProject && (
          <button
            type="button"
            onClick={() => onFormulationUuid(null)}
            className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/70"
            title="Clear project filter"
          >
            <X className="size-3" />
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

function ToggleBtn({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "inline-flex items-center gap-1.5 rounded px-2.5 py-1 font-medium transition " +
        (active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:bg-muted")
      }
    >
      {icon}
      {label}
    </button>
  );
}

function ProjectSelect({
  projects,
  value,
  onChange,
}: {
  projects: ShortageProject[];
  value: string | null;
  onChange: (uuid: string | null) => void;
}) {
  if (projects.length === 0) {
    return (
      <span className="text-[11px] text-muted-foreground">
        No projects linked to open MOs yet.
      </span>
    );
  }
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      className="h-8 rounded-md border border-border/60 bg-background px-2 text-xs"
      aria-label="Filter by project"
    >
      <option value="">All projects</option>
      {projects.map((p) => (
        <option key={p.formulation_uuid} value={p.formulation_uuid}>
          {p.formulation_name ?? p.formulation_uuid.slice(0, 8)}
        </option>
      ))}
    </select>
  );
}

// ────────────────────────────────────────────────────────────────────
// Vendor-grouped view
// ────────────────────────────────────────────────────────────────────

interface VendorCluster {
  key: string;
  vendor: ShortageVendorCandidate | null;
  rows: ShortageRow[];
}

function VendorClusterView({
  rows,
  loading,
  error,
  onRetry,
  companyDateFormat,
}: {
  rows: ShortageRow[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  companyDateFormat: FormatPrefs | null;
}) {
  const clusters = useMemo<VendorCluster[]>(() => {
    const map = new Map<string, VendorCluster>();
    for (const row of rows) {
      const primary = row.vendor_candidates?.[0] ?? null;
      const key = primary ? `v:${primary.vendor_id}` : UNASSIGNED_KEY;
      let cluster = map.get(key);
      if (!cluster) {
        cluster = { key, vendor: primary, rows: [] };
        map.set(key, cluster);
      }
      cluster.rows.push(row);
    }
    const out = Array.from(map.values());
    out.sort((a, b) => {
      if (a.key === UNASSIGNED_KEY) return -1;
      if (b.key === UNASSIGNED_KEY) return 1;
      return (a.vendor?.vendor_name ?? "").localeCompare(
        b.vendor?.vendor_name ?? "",
      );
    });
    return out;
  }, [rows]);

  if (loading && rows.length === 0) {
    return <LoadingState />;
  }
  if (error) {
    return <ErrorState message={error} onRetry={onRetry} />;
  }
  if (clusters.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="space-y-3">
      {clusters.map((cluster) => (
        <VendorClusterCard
          key={cluster.key}
          cluster={cluster}
          companyDateFormat={companyDateFormat}
        />
      ))}
    </div>
  );
}

function VendorClusterCard({
  cluster,
  companyDateFormat,
}: {
  cluster: VendorCluster;
  companyDateFormat: FormatPrefs | null;
}) {
  const [open, setOpen] = useState(true);
  const isOrphan = cluster.vendor === null;

  const createPoHref = useMemo(() => {
    if (isOrphan) return null;
    const payload = cluster.rows
      .map((r) => {
        if (!r.item?.uuid) return null;
        // Pre-fill qty = shortage_qty (the exact gap the buyer owes).
        // Falls back to required_qty on the "book from stock"
        // edge-case rows the operator explicitly flagged (shortage
        // is zero but a PO was requested anyway).
        const shortage = Number(r.shortage_qty);
        const qty =
          shortage > 0 ? r.shortage_qty : r.required_qty;
        return { item_uuid: r.item.uuid, qty };
      })
      .filter((r): r is { item_uuid: string; qty: string } => r !== null);
    if (payload.length === 0) return null;
    // Base64url encode. Keeps the URL short + plain-text decodable
    // in DevTools for debugging.
    const base64 = typeof window === "undefined"
      ? Buffer.from(JSON.stringify(payload)).toString("base64")
      : window.btoa(JSON.stringify(payload));
    const base64url = base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const qs = new URLSearchParams();
    qs.set("vendor_id", String(cluster.vendor!.vendor_id));
    qs.set("prefill", base64url);
    // Preserve the R&D flag if every row in the cluster is R&D. Mixed
    // clusters leave the flag off so the buyer sees the explicit
    // check-box state and ticks it only when the PO is R&D-pure.
    const allRnd = cluster.rows.every((r) => r.is_rnd);
    if (allRnd) qs.set("is_rnd", "1");
    return `/procurement/purchase-orders/new?${qs.toString()}`;
  }, [cluster, isOrphan]);

  const estimatedSpend = useMemo(() => {
    if (!cluster.vendor) return null;
    let total = 0;
    let currency: string | null = null;
    for (const r of cluster.rows) {
      // Match the row's shortage qty against the primary vendor's
      // term price. Mixed-currency clusters surface the first
      // currency we see and skip rows that don't match it — a
      // deliberate choice to avoid pretending we can sum GBP + USD
      // without the FX leg.
      const vendor = r.vendor_candidates?.[0];
      if (!vendor?.price) continue;
      if (currency === null) currency = vendor.currency_code;
      if (vendor.currency_code !== currency) continue;
      const price = Number(vendor.price);
      const qty = Number(r.shortage_qty);
      if (Number.isFinite(price) && Number.isFinite(qty)) {
        total += price * qty;
      }
    }
    if (!currency || total <= 0) return null;
    return `${currency} ${total.toFixed(2)}`;
  }, [cluster]);

  return (
    <section className="rounded-xl border border-border/60 bg-card">
      <header className="flex flex-wrap items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-1 text-sm font-semibold hover:text-foreground"
          aria-expanded={open}
        >
          <ChevronRight
            className={
              "size-3.5 shrink-0 transition " + (open ? "rotate-90" : "")
            }
          />
          {isOrphan ? (
            <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
              <AlertTriangle className="size-3.5" />
              Unassigned — no vendor approved yet
            </span>
          ) : (
            <span>
              <Link
                href={`/vendors/${encodeURIComponent(cluster.vendor!.vendor_uuid)}`}
                className="hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {cluster.vendor!.vendor_name}
              </Link>
            </span>
          )}
        </button>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span>
            {cluster.rows.length} line
            {cluster.rows.length === 1 ? "" : "s"}
          </span>
          {cluster.vendor?.lead_time_days != null && (
            <span>· {cluster.vendor.lead_time_days}d lead</span>
          )}
          {estimatedSpend && <span>· est. {estimatedSpend}</span>}
          {cluster.vendor?.source === "approved" && (
            <span className="rounded-full border border-dashed border-amber-500/40 px-1.5 text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-300">
              approved only
            </span>
          )}
        </div>
        <div className="ml-auto">
          {createPoHref ? (
            <Button asChild size="sm">
              <Link href={createPoHref}>
                <ShoppingCart className="mr-1.5 size-3.5" />
                Create PO
              </Link>
            </Button>
          ) : (
            <span
              className="text-[11px] text-muted-foreground"
              title="Approve a vendor for every item in this cluster before raising a PO."
            >
              —
            </span>
          )}
        </div>
      </header>

      {open && (
        <div className="border-t border-border/60">
          <table className="w-full text-sm">
            <thead className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Item</th>
                <th className="px-4 py-2 text-right">Short</th>
                <th className="px-4 py-2 text-right">Required</th>
                <th className="px-4 py-2">Waiting MOs</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {cluster.rows.map((r) => (
                <ClusterRowItem
                  key={String(r.item?.id ?? r.item?.uuid ?? r.shortage_qty)}
                  row={r}
                  companyDateFormat={companyDateFormat}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ClusterRowItem({
  row,
  companyDateFormat,
}: {
  row: ShortageRow;
  companyDateFormat: FormatPrefs | null;
}) {
  const uom = row.line_uom?.symbol ?? row.item?.stock_uom?.symbol ?? "";
  const shortage = formatQtyHumanized(row.shortage_qty, uom, companyDateFormat);
  const required = formatQtyHumanized(row.required_qty, uom, companyDateFormat);
  return (
    <tr className="border-t border-border/40 text-xs">
      <td className="px-4 py-2">
        <div className="flex items-center gap-1.5">
          <span className="font-medium">
            {row.item?.name ?? "Unknown item"}
          </span>
          {row.is_rnd && (
            <span className="shrink-0 rounded-full border border-purple-500/30 bg-purple-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-purple-700 dark:text-purple-400">
              R&amp;D
            </span>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground">
          {row.item?.item_type ?? "—"}
        </p>
      </td>
      <td className="px-4 py-2 text-right font-mono text-red-700 dark:text-red-300">
        {shortage.value} {shortage.unit}
      </td>
      <td className="px-4 py-2 text-right font-mono text-muted-foreground">
        {required.value} {required.unit}
      </td>
      <td className="px-4 py-2">
        {row.dependent_mos.length === 0 ? (
          <span className="text-muted-foreground/50">—</span>
        ) : (
          <div className="flex flex-wrap items-center gap-1">
            {row.dependent_mos.slice(0, 2).map((mo) => (
              <Link
                key={mo.uuid}
                href={`/production/manufacturing-orders/${mo.uuid}`}
                className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-mono hover:bg-muted/70"
              >
                {mo.code ?? mo.uuid.slice(0, 8)}
              </Link>
            ))}
            {row.dependent_mos.length > 2 && (
              <span className="text-[10px] text-muted-foreground">
                +{row.dependent_mos.length - 2}
              </span>
            )}
          </div>
        )}
      </td>
      <td className="px-4 py-2 text-right">
        {row.item?.uuid && (
          <Button
            asChild
            size="sm"
            variant="outline"
            className="h-7 text-[11px]"
          >
            <Link
              href={`/procurement/purchase-orders/new?item_uuid=${encodeURIComponent(
                row.item.uuid,
              )}&qty=${encodeURIComponent(row.shortage_qty)}${
                row.is_rnd ? "&is_rnd=1" : ""
              }`}
            >
              <ShoppingCart className="mr-1 size-3" />
              PO
            </Link>
          </Button>
        )}
      </td>
    </tr>
  );
}

// ────────────────────────────────────────────────────────────────────
// Project-grouped view (lightweight — groups rows by the formulation_uuid
// their dependent MOs touch; clicking a cluster scopes the whole page)
// ────────────────────────────────────────────────────────────────────

interface ProjectCluster {
  formulation_uuid: string | null;
  formulation_name: string | null;
  rows: ShortageRow[];
}

function ProjectClusterView({
  rows,
  loading,
  error,
  onRetry,
  onPick,
  companyDateFormat,
}: {
  rows: ShortageRow[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onPick: (uuid: string | null) => void;
  companyDateFormat: FormatPrefs | null;
}) {
  const clusters = useMemo<ProjectCluster[]>(() => {
    const map = new Map<string, ProjectCluster>();
    for (const row of rows) {
      // A single row can touch multiple projects (one BOM item used by
      // more than one MO on different formulations). Fan-out the row
      // into every project it touches so the operator can scope each
      // cluster independently. De-dup to a Set so a row with two MOs
      // on the SAME project doesn't appear twice in its cluster.
      const seen = new Set<string>();
      for (const mo of row.dependent_mos) {
        const key = mo.formulation_uuid ?? UNASSIGNED_KEY;
        if (seen.has(key)) continue;
        seen.add(key);
        let cluster = map.get(key);
        if (!cluster) {
          cluster = {
            formulation_uuid: mo.formulation_uuid,
            formulation_name: mo.formulation_name,
            rows: [],
          };
          map.set(key, cluster);
        }
        cluster.rows.push(row);
      }
      if (row.dependent_mos.length === 0) {
        let cluster = map.get(UNASSIGNED_KEY);
        if (!cluster) {
          cluster = {
            formulation_uuid: null,
            formulation_name: null,
            rows: [],
          };
          map.set(UNASSIGNED_KEY, cluster);
        }
        cluster.rows.push(row);
      }
    }
    const out = Array.from(map.values());
    out.sort((a, b) => {
      if (!a.formulation_uuid) return 1;
      if (!b.formulation_uuid) return -1;
      return (a.formulation_name ?? "").localeCompare(b.formulation_name ?? "");
    });
    return out;
  }, [rows]);

  if (loading && rows.length === 0) {
    return <LoadingState />;
  }
  if (error) {
    return <ErrorState message={error} onRetry={onRetry} />;
  }
  if (clusters.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="space-y-3">
      {clusters.map((cluster) => (
        <ProjectClusterCard
          key={cluster.formulation_uuid ?? UNASSIGNED_KEY}
          cluster={cluster}
          onPick={onPick}
          companyDateFormat={companyDateFormat}
        />
      ))}
    </div>
  );
}

function ProjectClusterCard({
  cluster,
  onPick,
  companyDateFormat,
}: {
  cluster: ProjectCluster;
  onPick: (uuid: string | null) => void;
  companyDateFormat: FormatPrefs | null;
}) {
  const [open, setOpen] = useState(true);
  const label = cluster.formulation_name ?? "Unassigned (no customer order)";
  return (
    <section className="rounded-xl border border-border/60 bg-card">
      <header className="flex flex-wrap items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-1 text-sm font-semibold"
        >
          <ChevronRight
            className={
              "size-3.5 shrink-0 transition " + (open ? "rotate-90" : "")
            }
          />
          {label}
        </button>
        <span className="text-[11px] text-muted-foreground">
          {cluster.rows.length} short item
          {cluster.rows.length === 1 ? "" : "s"}
        </span>
        {cluster.formulation_uuid && (
          <div className="ml-auto">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onPick(cluster.formulation_uuid)}
            >
              Scope page to this project
            </Button>
          </div>
        )}
      </header>
      {open && (
        <div className="border-t border-border/60">
          <table className="w-full text-sm">
            <thead className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Item</th>
                <th className="px-4 py-2 text-right">Short</th>
                <th className="px-4 py-2">Primary vendor</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {cluster.rows.map((r) => {
                const uom =
                  r.line_uom?.symbol ?? r.item?.stock_uom?.symbol ?? "";
                const short = formatQtyHumanized(
                  r.shortage_qty,
                  uom,
                  companyDateFormat,
                );
                const vendor = r.vendor_candidates?.[0] ?? null;
                return (
                  <tr
                    key={String(
                      r.item?.id ?? r.item?.uuid ?? r.shortage_qty,
                    )}
                    className="border-t border-border/40 text-xs"
                  >
                    <td className="px-4 py-2">
                      {r.item?.name ?? "Unknown item"}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-red-700 dark:text-red-300">
                      {short.value} {short.unit}
                    </td>
                    <td className="px-4 py-2">
                      {vendor ? (
                        <Link
                          href={`/vendors/${encodeURIComponent(vendor.vendor_uuid)}`}
                          className="inline-flex items-center gap-1 text-xs hover:underline"
                        >
                          <Store className="size-3 text-muted-foreground" />
                          {vendor.vendor_name}
                        </Link>
                      ) : (
                        <span className="text-amber-700 dark:text-amber-300">
                          No vendor
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {r.item?.uuid && (
                        <Button
                          asChild
                          size="sm"
                          variant="outline"
                          className="h-7 text-[11px]"
                        >
                          <Link
                            href={`/procurement/purchase-orders/new?item_uuid=${encodeURIComponent(
                              r.item.uuid,
                            )}&qty=${encodeURIComponent(r.shortage_qty)}${
                              r.is_rnd ? "&is_rnd=1" : ""
                            }`}
                          >
                            <ShoppingCart className="mr-1 size-3" />
                            PO
                          </Link>
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────
// Shared empty / loading / error states
// ────────────────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="rounded-xl border border-dashed border-border/60 bg-muted/10 px-6 py-12 text-center text-sm text-muted-foreground">
      Loading shortages…
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-border/60 bg-muted/10 px-6 py-12 text-center text-sm text-muted-foreground">
      Nothing short in this view.
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-destructive/40 bg-destructive/5 px-6 py-10 text-center text-sm text-destructive">
      <p>Couldn&apos;t load shortages: {message}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
