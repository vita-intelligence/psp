"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  AlertTriangle,
  CheckCheck,
  CheckCircle2,
  FileText,
  Loader2,
  Microscope,
  Package,
  PackageOpen,
  Pencil,
  RefreshCw,
  Search,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ErrorBanner } from "@/components/forms/error-banner";
import { DimensionMmInput } from "@/components/forms/dimension-mm-input";
import { PackBoxPreview } from "@/components/packaging/pack-box-preview";
import { cn } from "@/lib/utils";
import { formatCompanyDate, type FormatPrefs } from "@/lib/format/company";
import type { OutputQcEntry } from "@/lib/production/types";
import { signOffOutputQcAction } from "@/lib/production-output-qc/actions";

interface Filters {
  search: string;
  itemType: string;
  projectType: string;
  workstationGroupUuid: string;
}

interface WorkstationGroupOption {
  uuid: string;
  name: string;
}

interface Props {
  initialQueue: OutputQcEntry[];
  initialCursor: string | null;
  initialFilters: Filters;
  workstationGroups: WorkstationGroupOption[];
  companyDateFormat: FormatPrefs | null;
}

export function OutputQcWorkspace({
  initialQueue,
  initialCursor,
  initialFilters,
  workstationGroups,
  companyDateFormat,
}: Props) {
  const [queue, setQueue] = useState<OutputQcEntry[]>(initialQueue);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [searchInput, setSearchInput] = useState(initialFilters.search);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const filterQs = useMemo(() => {
    const p = new URLSearchParams();
    p.set("limit", "50");
    if (filters.search) p.set("search", filters.search);
    if (filters.itemType) p.set("item_type", filters.itemType);
    if (filters.projectType) p.set("project_type", filters.projectType);
    if (filters.workstationGroupUuid)
      p.set("workstation_group_uuid", filters.workstationGroupUuid);
    return p;
  }, [filters]);

  // Debounce search input → filters
  useEffect(() => {
    if (searchInput === filters.search) return;
    const id = window.setTimeout(() => {
      setFilters((f) => ({ ...f, search: searchInput.trim() }));
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, filters.search]);

  // Re-fetch first page whenever filters change
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    (async () => {
      try {
        const res = await fetch(
          `/api/production/output-qc?${filterQs.toString()}`,
          { cache: "no-store" },
        );
        if (!res.ok) {
          if (!cancelled)
            setErrorDetail(`Couldn't load the queue (${res.status}).`);
          return;
        }
        const body = (await res.json()) as {
          items: OutputQcEntry[];
          next_cursor: string | null;
        };
        if (cancelled) return;
        setQueue(body.items);
        setCursor(body.next_cursor);
        setErrorDetail(null);
      } catch (err) {
        if (!cancelled)
          setErrorDetail(
            err instanceof Error ? err.message : "Network blip — try again.",
          );
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filterQs]);

  // Infinite scroll: fetch next page when sentinel is visible
  useEffect(() => {
    if (!cursor) return;
    const node = sentinelRef.current;
    if (!node) return;

    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        if (isLoading) return;

        setIsLoading(true);
        const p = new URLSearchParams(filterQs);
        p.set("cursor", cursor);
        fetch(`/api/production/output-qc?${p.toString()}`, { cache: "no-store" })
          .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
          .then((body: { items: OutputQcEntry[]; next_cursor: string | null }) => {
            setQueue((prev) => prev.concat(body.items));
            setCursor(body.next_cursor);
            setErrorDetail(null);
          })
          .catch((e) =>
            setErrorDetail(
              typeof e === "number"
                ? `Couldn't load more (${e}).`
                : "Network blip — try again.",
            ),
          )
          .finally(() => setIsLoading(false));
      },
      { rootMargin: "400px 0px" },
    );

    io.observe(node);
    return () => io.disconnect();
  }, [cursor, filterQs, isLoading]);

  return (
    <section className="space-y-3">
      <FilterBar
        searchInput={searchInput}
        setSearchInput={setSearchInput}
        filters={filters}
        setFilters={setFilters}
        workstationGroups={workstationGroups}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {queue.length === 0
            ? isLoading
              ? "Loading queue…"
              : "Nothing matches these filters."
            : `${queue.length} lot${queue.length === 1 ? "" : "s"} loaded${cursor ? " (more available)" : ""}`}
        </p>
        {(filters.search ||
          filters.itemType ||
          filters.projectType ||
          filters.workstationGroupUuid) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearchInput("");
              setFilters({
                search: "",
                itemType: "",
                projectType: "",
                workstationGroupUuid: "",
              });
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      {errorDetail && <ErrorBanner detail={errorDetail} />}

      {queue.length === 0 && !isLoading ? (
        <EmptyState />
      ) : (
        <QueueTable entries={queue} companyDateFormat={companyDateFormat} />
      )}

      {cursor && (
        <div
          ref={sentinelRef}
          className="flex items-center justify-center py-4 text-xs text-muted-foreground"
        >
          {isLoading && (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="size-3 animate-spin" /> Loading more…
            </span>
          )}
        </div>
      )}

      {!cursor && queue.length > 0 && (
        <p className="border-t border-border/60 pt-3 text-center text-[11px] text-muted-foreground">
          End of queue · {queue.length} total
        </p>
      )}

    </section>
  );
}

function QueueTable({
  entries,
  companyDateFormat,
}: {
  entries: OutputQcEntry[];
  companyDateFormat: FormatPrefs | null;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border/60 bg-card">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/60 bg-muted/30 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="px-3 py-2 font-semibold">Item</th>
            <th className="px-3 py-2 font-semibold">Type</th>
            <th className="px-3 py-2 font-semibold">Project</th>
            <th className="px-3 py-2 font-semibold">MO</th>
            <th className="px-3 py-2 text-right font-semibold">Qty</th>
            <th className="px-3 py-2 font-semibold">Finished</th>
            <th className="px-3 py-2 font-semibold">Lot code</th>
            <th className="w-0 px-3 py-2 text-right font-semibold" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border/40">
          {entries.map((entry) => (
            <QueueRow
              key={entry.lot.uuid}
              entry={entry}
              companyDateFormat={companyDateFormat}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QueueRow({
  entry,
  companyDateFormat,
}: {
  entry: OutputQcEntry;
  companyDateFormat: FormatPrefs | null;
}) {
  const { lot, mo } = entry;
  const uomSymbol = lot.uom?.symbol ?? "ea";
  const href = `/production/output-qc/${encodeURIComponent(lot.uuid)}`;

  return (
    <tr className="hover:bg-muted/40">
      <td className="px-3 py-2">
        <a
          href={href}
          className="font-medium underline-offset-2 hover:underline"
        >
          {lot.item?.name ?? "Unknown item"}
        </a>
      </td>
      <td className="px-3 py-2 text-muted-foreground">
        {entry.item_type ? (
          <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
            {entry.item_type.replace("_", " ")}
          </span>
        ) : (
          "—"
        )}
      </td>
      <td className="px-3 py-2">
        {mo?.project_type && mo.project_type !== "production" ? (
          <span className="inline-flex items-center rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-400">
            {mo.project_type}
          </span>
        ) : (
          <span className="text-muted-foreground">production</span>
        )}
      </td>
      <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
        {mo?.code ?? (mo ? `MO #${mo.id}` : "—")}
      </td>
      <td className="px-3 py-2 text-right font-mono tabular-nums">
        {lot.qty_received}
        <span className="ml-1 text-[10px] text-muted-foreground">{uomSymbol}</span>
      </td>
      <td className="px-3 py-2 text-muted-foreground">
        {mo?.actual_finish
          ? formatCompanyDate(mo.actual_finish, companyDateFormat)
          : "—"}
      </td>
      <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
        {lot.code ?? "—"}
      </td>
      <td className="px-3 py-2 text-right">
        <Button asChild size="sm" variant="outline" className="h-7">
          <a href={href}>Review →</a>
        </Button>
      </td>
    </tr>
  );
}

function FilterBar({
  searchInput,
  setSearchInput,
  filters,
  setFilters,
  workstationGroups,
}: {
  searchInput: string;
  setSearchInput: (v: string) => void;
  filters: Filters;
  setFilters: (fn: (prev: Filters) => Filters) => void;
  workstationGroups: WorkstationGroupOption[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-card p-3">
      <div className="relative min-w-[14rem] flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search item name…"
          className="pl-8 h-9 text-sm"
        />
      </div>
      <FilterSelect
        label="Item type"
        value={filters.itemType}
        onChange={(v) => setFilters((p) => ({ ...p, itemType: v }))}
        options={[
          { value: "", label: "All types" },
          { value: "finished_product", label: "Finished" },
          { value: "semi_finished", label: "Semi-finished" },
          { value: "raw_material", label: "Raw material" },
          { value: "packaging", label: "Packaging" },
          { value: "consumable", label: "Consumable" },
        ]}
      />
      <FilterSelect
        label="Project"
        value={filters.projectType}
        onChange={(v) => setFilters((p) => ({ ...p, projectType: v }))}
        options={[
          { value: "", label: "All projects" },
          { value: "production", label: "Production" },
          { value: "trial", label: "Trial" },
          { value: "sample", label: "Sample" },
        ]}
      />
      <FilterSelect
        label="Cell"
        value={filters.workstationGroupUuid}
        onChange={(v) => setFilters((p) => ({ ...p, workstationGroupUuid: v }))}
        options={[
          { value: "", label: "All cells" },
          ...workstationGroups.map((g) => ({ value: g.uuid, label: g.name })),
        ]}
      />
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="h-9 min-w-[9rem] rounded-md border border-border/60 bg-background px-2 text-xs text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function QcCard({
  entry,
  companyDateFormat,
  onSignedOff,
  onViewSpec,
}: {
  entry: OutputQcEntry;
  companyDateFormat: FormatPrefs | null;
  onSignedOff: () => void;
  onViewSpec?: () => void;
}) {
  const { lot, mo } = entry;
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  // Track the whole error envelope, not just detail — the BE returns
  // per-field messages under `fields` on 422 responses, and we want
  // the operator to see "units_per_package: must be greater than 0"
  // instead of the generic "One or more fields failed validation."
  const [error, setError] = useState<{
    detail: string;
    fields?: Record<string, string[]>;
  } | null>(null);
  const [mode, setMode] = useState<"idle" | "fail" | "edit">("idle");
  const [scope, setScope] = useState<"full" | "partial">("full");
  // Pass-with-adjustments draft. Pre-filled with whatever production
  // recorded so a one-tap "looks right, pass it" still works — the
  // operator only edits the fields they actually want to correct.
  const [passDraft, setPassDraft] = useState({
    qty_received: String(lot.qty_received ?? ""),
    package_length_mm: String(lot.package_length_mm ?? ""),
    package_width_mm: String(lot.package_width_mm ?? ""),
    package_height_mm: String(lot.package_height_mm ?? ""),
    package_weight_kg: String(lot.package_weight_kg ?? ""),
    units_per_package: String(lot.units_per_package ?? ""),
    stack_factor: String(lot.stack_factor ?? "1"),
  });
  // Partial-fail state: how much to reject + new packaging for both
  // halves of the split. Pre-fill the parent dims with the lot's
  // current measurements (operator usually only adjusts a few),
  // child stays blank because that pack didn't exist before now.
  const [rejectQty, setRejectQty] = useState<string>("");
  const [parentPkg, setParentPkg] = useState({
    length_mm: String(lot.package_length_mm ?? ""),
    width_mm: String(lot.package_width_mm ?? ""),
    height_mm: String(lot.package_height_mm ?? ""),
    weight_kg: lot.package_weight_kg ?? "",
    stack_factor: String(lot.stack_factor ?? "1"),
  });
  const [childPkg, setChildPkg] = useState({
    length_mm: "",
    width_mm: "",
    height_mm: "",
    weight_kg: "",
    stack_factor: "1",
  });
  const uomSymbol = lot.uom?.symbol ?? "ea";

  // R&D pass gate — trial/sample MOs can't pass Output QC until NPD
  // has signed off the paired ProductValidation. The BE enforces the
  // same rule; this just disables the button + explains why so the
  // operator isn't clicking a button that always errors.
  const npdGate = computeNpdGate(mo);

  function pass() {
    setError(null);

    // Build adjustments only when something actually differs from
    // production's recorded value. Equal values get dropped so the
    // BE doesn't see them as edits in the audit trail.
    const adjustments: Record<string, string> = {};
    if (mode === "edit") {
      const compare: Array<[keyof typeof passDraft, string]> = [
        ["qty_received", String(lot.qty_received ?? "")],
        ["package_length_mm", String(lot.package_length_mm ?? "")],
        ["package_width_mm", String(lot.package_width_mm ?? "")],
        ["package_height_mm", String(lot.package_height_mm ?? "")],
        ["package_weight_kg", String(lot.package_weight_kg ?? "")],
        ["units_per_package", String(lot.units_per_package ?? "")],
        ["stack_factor", String(lot.stack_factor ?? "")],
      ];
      for (const [key, original] of compare) {
        const next = passDraft[key].trim();
        if (next !== "" && next !== original) {
          adjustments[key] = next;
        }
      }
    }

    startTransition(async () => {
      const res = await signOffOutputQcAction(lot.uuid, "pass", {
        reason: mode === "edit" ? reason.trim() || null : null,
        ...adjustments,
      });
      if (res.ok) {
        toast.success(
          mode === "edit" && Object.keys(adjustments).length > 0
            ? "QC adjusted + passed — lot now available"
            : "QC passed — lot now available",
        );
        onSignedOff();
      } else {
        setError({ detail: res.detail, fields: res.fields });
      }
    });
  }

  function patchPass(field: keyof typeof passDraft, value: string) {
    setPassDraft((prev) => ({ ...prev, [field]: value }));
  }

  function fail() {
    if (mode !== "fail") {
      setMode("fail");
      return;
    }
    if (!reason.trim()) {
      setError({ detail: "Add a reason before failing the lot." });
      return;
    }

    if (scope === "partial") {
      const qtyNum = Number(rejectQty.trim());
      const fullQty = Number(lot.qty_received);
      if (!rejectQty.trim() || Number.isNaN(qtyNum) || qtyNum <= 0) {
        setError({ detail: "Reject qty must be a positive number." });
        return;
      }
      if (qtyNum >= fullQty) {
        setError({
          detail: `Reject qty must be less than the lot's ${fullQty} ${uomSymbol} — switch to Fail all to reject everything.`,
        });
        return;
      }
      // Both packagings required + positive.
      const pkgs: Array<[string, typeof parentPkg]> = [
        ["remainder", parentPkg],
        ["rejected", childPkg],
      ];
      for (const [label, pkg] of pkgs) {
        for (const [field, val] of Object.entries(pkg)) {
          const n = Number(val.toString().trim());
          if (val.toString().trim() === "" || Number.isNaN(n) || n <= 0) {
            setError({
              detail: `${label} packaging: ${field.replace("_", " ")} must be a positive number.`,
            });
            return;
          }
        }
      }
    }

    setError(null);
    startTransition(async () => {
      const res = await signOffOutputQcAction(lot.uuid, "fail", {
        reason,
        reject_qty: scope === "partial" ? rejectQty.trim() : null,
        parent_packaging:
          scope === "partial"
            ? {
                length_mm: parentPkg.length_mm.trim(),
                width_mm: parentPkg.width_mm.trim(),
                height_mm: parentPkg.height_mm.trim(),
                weight_kg: parentPkg.weight_kg.toString().trim(),
                stack_factor: parentPkg.stack_factor.trim(),
              }
            : undefined,
        child_packaging:
          scope === "partial"
            ? {
                length_mm: childPkg.length_mm.trim(),
                width_mm: childPkg.width_mm.trim(),
                height_mm: childPkg.height_mm.trim(),
                weight_kg: childPkg.weight_kg.trim(),
                stack_factor: childPkg.stack_factor.trim(),
              }
            : undefined,
      });
      if (res.ok) {
        toast.success(
          scope === "partial"
            ? "Partial fail recorded — lot split, remainder still in QC"
            : "QC failed — lot flagged",
        );
        onSignedOff();
      } else {
        setError({ detail: res.detail, fields: res.fields });
      }
    });
  }

  const breadcrumb = lot.production_cell
    ? [
        lot.production_cell.storage_location?.floor?.warehouse?.name,
        lot.production_cell.storage_location?.floor?.name,
        lot.production_cell.storage_location?.code ??
          lot.production_cell.storage_location?.name,
        lot.production_cell.name,
      ]
        .filter((v): v is string => !!v && v.length > 0)
        .join(" · ")
    : null;

  return (
    <li className="rounded-xl border border-border/60 bg-card p-4 space-y-3 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
              <Microscope className="size-2.5" />
              Awaiting QC
            </span>
            {lot.code && (
              <span className="font-mono text-[11px] text-muted-foreground">
                {lot.code}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">
              {lot.item?.name ?? "Unknown item"}
            </p>
            {entry.item_type && (
              <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {entry.item_type.replace("_", " ")}
              </span>
            )}
            {mo?.project_type && mo.project_type !== "production" && (
              <span className="inline-flex items-center rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-400">
                {mo.project_type}
              </span>
            )}
            {onViewSpec && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onViewSpec}
                className="ml-auto h-6 px-2 text-[10px] font-medium"
              >
                <FileText className="mr-1 size-3" />
                View spec
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <PackageOpen className="size-3" />
              {lot.qty_received} {uomSymbol}
            </span>
            {breadcrumb && (
              <span className="inline-flex items-center gap-1">
                <Package className="size-3" />
                {breadcrumb}
              </span>
            )}
            {mo && (
              <span>
                From{" "}
                <span className="font-mono">
                  {mo.code ?? `MO #${mo.id}`}
                </span>
                {mo.actual_finish && (
                  <>
                    {" · finished "}
                    {formatCompanyDate(mo.actual_finish, companyDateFormat)}
                  </>
                )}
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={fail}
              disabled={pending || npdGate.blocked}
              title={npdGate.blocked ? npdGate.reason : undefined}
              className={cn(
                "border-rose-500/40 text-rose-700 hover:bg-rose-500/10 dark:text-rose-300",
                mode === "fail" && "bg-rose-500/10",
              )}
            >
              <XCircle className="mr-1.5 size-3.5" />
              {mode === "fail" ? "Confirm fail" : "Fail QC"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                setMode((m) => (m === "edit" ? "idle" : "edit"))
              }
              disabled={pending}
              className={cn(mode === "edit" && "bg-muted")}
            >
              <Pencil className="mr-1.5 size-3.5" />
              {mode === "edit" ? "Cancel edit" : "Adjust"}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={pass}
              disabled={pending || npdGate.blocked}
              title={npdGate.blocked ? npdGate.reason : undefined}
            >
              {pending && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
              <CheckCircle2 className="mr-1.5 size-3.5" />
              {mode === "edit" ? "Save & pass" : "Pass QC"}
            </Button>
          </div>
        </div>
      </div>

      {/* Sequential-wizard nudge — screams at the operator when the
          Pass / Fail buttons are locked because the NPD product
          validation form hasn't reached ``passed`` yet. Renders
          only when the gate blocks (so on production MOs, or trial
          batches whose validation already passed, this section is
          invisible). Positioned right below the button row so the
          "why is this greyed out" answer is inches from the greyed
          buttons. The bigger prompt in ``NpdValidationCard`` at the
          top of the page carries the "Open on NPD" jump link; this
          inline banner exists so the operator scrolled down to the
          QC card doesn't have to scroll back up to find the answer. */}
      {npdGate.blocked && (
        <div className="flex items-start gap-3 rounded-lg border-2 border-amber-500/60 bg-amber-50 px-4 py-3 dark:border-amber-500/40 dark:bg-amber-950/30">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
              Finish the trial batch validation form first
            </p>
            <p className="text-xs text-amber-800 dark:text-amber-200/90">
              Pass and Fail are locked until the NPD product
              validation reaches <span className="font-semibold">Passed</span>.
              Scroll up to the &quot;Trial validation on NPD&quot;
              card and click <span className="font-semibold">Open
              on NPD</span> to complete the weight / hardness /
              disintegration / organoleptic tests, then sign as
              scientist + R&amp;D manager. This QC card unlocks
              automatically once NPD pushes the passed status back
              to PSP.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-4">
        <Spec label="Length" value={lot.package_length_mm} unit="mm" />
        <Spec label="Width" value={lot.package_width_mm} unit="mm" />
        <Spec label="Height" value={lot.package_height_mm} unit="mm" />
        <Spec label="Weight" value={lot.package_weight_kg} unit="kg" />
      </div>

      {mode === "edit" && (
        <div className="space-y-3 rounded-md border border-border/60 bg-muted/30 px-3 py-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">
                Adjust before accepting
              </p>
              <p className="text-[11px] text-muted-foreground">
                Production typed estimates — measure again and correct
                anything off. A qty change emits an adjust movement
                at the production-feed cell so the books stay honest.
              </p>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <PackInput
              label={`Qty (${uomSymbol})`}
              value={passDraft.qty_received}
              onChange={(v) => patchPass("qty_received", v)}
            />
            <DimensionMmInput
              label="Length"
              value={passDraft.package_length_mm}
              onChange={(v) => patchPass("package_length_mm", v)}
            />
            <DimensionMmInput
              label="Width"
              value={passDraft.package_width_mm}
              onChange={(v) => patchPass("package_width_mm", v)}
            />
            <DimensionMmInput
              label="Height"
              value={passDraft.package_height_mm}
              onChange={(v) => patchPass("package_height_mm", v)}
            />
            <PackInput
              label="Weight, gross (kg)"
              value={passDraft.package_weight_kg}
              onChange={(v) => patchPass("package_weight_kg", v)}
            />
            <PackInput
              label="Stack factor"
              value={passDraft.stack_factor}
              onChange={(v) => patchPass("stack_factor", v)}
            />
          </div>
          <PackBoxPreview
            lengthMm={Number(passDraft.package_length_mm) || 0}
            widthMm={Number(passDraft.package_width_mm) || 0}
            heightMm={Number(passDraft.package_height_mm) || 0}
            stack={Number(passDraft.stack_factor) || 1}
          />
          <div className="space-y-1">
            <Label htmlFor={`qc-reason-${lot.uuid}`} className="text-xs">
              Reason (optional)
            </Label>
            <Textarea
              id={`qc-reason-${lot.uuid}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Recorded with the adjust movement for the audit log"
              className="min-h-[60px] text-sm"
            />
          </div>
        </div>
      )}

      {mode === "fail" && (
        <div className="space-y-3 rounded-md border border-rose-500/40 bg-rose-500/5 px-3 py-3">
          {/* Scope toggle — "all" is the common case (whole batch
              contaminated). "partial" exposes the split flow with
              qty + repackage fields. */}
          <div className="flex items-center gap-1 rounded-md border border-rose-500/30 bg-background p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setScope("full")}
              className={cn(
                "flex-1 rounded px-2 py-1 transition-colors",
                scope === "full"
                  ? "bg-rose-500/20 font-medium text-rose-900 dark:text-rose-100"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Fail entire lot ({lot.qty_received} {uomSymbol})
            </button>
            <button
              type="button"
              onClick={() => setScope("partial")}
              className={cn(
                "flex-1 rounded px-2 py-1 transition-colors",
                scope === "partial"
                  ? "bg-rose-500/20 font-medium text-rose-900 dark:text-rose-100"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Reject part — split lot
            </button>
          </div>

          {scope === "partial" && (
            <PartialSplitPanel
              lot={lot}
              uomSymbol={uomSymbol}
              rejectQty={rejectQty}
              onRejectQtyChange={setRejectQty}
              parentPkg={parentPkg}
              onParentPkgChange={setParentPkg}
              childPkg={childPkg}
              onChildPkgChange={setChildPkg}
            />
          )}

          <div className="space-y-1">
            <Label htmlFor={`qc-reason-${lot.uuid}`} className="text-xs">
              Reason
            </Label>
            <Textarea
              id={`qc-reason-${lot.uuid}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="e.g. off-colour, contamination suspected, out-of-spec assay"
              className="text-sm"
            />
          </div>

          <button
            type="button"
            className="text-[11px] text-muted-foreground hover:text-foreground"
            onClick={() => {
              setMode("idle");
              setScope("full");
              setReason("");
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {error && <ErrorBanner detail={error.detail} fields={error.fields} />}
    </li>
  );
}

type PartialPkg = {
  length_mm: string;
  width_mm: string;
  height_mm: string;
  weight_kg: string;
  stack_factor: string;
};

/**
 * The whole partial-fail block — qty math at the top so the operator
 * sees `Reject + Remainder = Total` live, then two repackage cards
 * (remainder + rejected) with the packaging-weight label clarified
 * so it isn't confused with the contents qty.
 */
function PartialSplitPanel({
  lot,
  uomSymbol,
  rejectQty,
  onRejectQtyChange,
  parentPkg,
  onParentPkgChange,
  childPkg,
  onChildPkgChange,
}: {
  lot: OutputQcEntry["lot"];
  uomSymbol: string;
  rejectQty: string;
  onRejectQtyChange: (v: string) => void;
  parentPkg: PartialPkg;
  onParentPkgChange: (next: PartialPkg) => void;
  childPkg: PartialPkg;
  onChildPkgChange: (next: PartialPkg) => void;
}) {
  const total = Number(lot.qty_received) || 0;
  const reject = Number(rejectQty) || 0;
  const remainder = total - reject;
  const validReject = reject > 0 && reject < total;

  return (
    <div className="space-y-3 rounded-md border border-rose-500/30 bg-background/40 p-3">
      {/* Qty math — read-only on the right, editable on the left.
          Live arithmetic so the operator never has to mental-math the
          remainder. */}
      <div className="space-y-2">
        <Label className="text-xs">
          How much to reject (contents only, in {uomSymbol})
        </Label>
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Total in lot
            </p>
            <div className="flex h-9 items-center rounded-md border border-border/60 bg-muted/30 px-3 font-mono text-sm">
              {total} {uomSymbol}
            </div>
          </div>
          <div className="space-y-1">
            <Label
              htmlFor={`qc-reject-qty-${lot.uuid}`}
              className="text-[10px] uppercase tracking-wider"
            >
              Reject
            </Label>
            <Input
              id={`qc-reject-qty-${lot.uuid}`}
              type="number"
              step="any"
              min={0}
              max={total}
              inputMode="decimal"
              value={rejectQty}
              onChange={(e) => onRejectQtyChange(e.target.value)}
              placeholder={`< ${total}`}
              className="h-9 font-mono"
            />
          </div>
          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Remainder = total − reject
            </p>
            <div
              className={cn(
                "flex h-9 items-center rounded-md border px-3 font-mono text-sm",
                validReject
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200"
                  : "border-border/60 bg-muted/30 text-muted-foreground",
              )}
            >
              {validReject
                ? `${remainder.toLocaleString(undefined, {
                    maximumFractionDigits: 4,
                  })} ${uomSymbol}`
                : "—"}
            </div>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Reject must be greater than 0 and less than the total. The
          kept portion stays in QC awaiting a separate verdict; the
          rejected portion becomes its own `rejected` lot.
        </p>
      </div>

      <PartialPackagingBlock
        title={`Remainder package — kept portion${
          validReject
            ? ` (${remainder.toLocaleString(undefined, {
                maximumFractionDigits: 4,
              })} ${uomSymbol})`
            : ""
        }`}
        pkg={parentPkg}
        onChange={onParentPkgChange}
      />
      <PartialPackagingBlock
        title={`Rejected package — failed portion${
          validReject
            ? ` (${reject.toLocaleString(undefined, {
                maximumFractionDigits: 4,
              })} ${uomSymbol})`
            : ""
        }`}
        pkg={childPkg}
        onChange={onChildPkgChange}
      />
    </div>
  );
}

/**
 * 6-field packaging mini-form used inside the partial-fail panel.
 * Operator re-measures the kept and the rejected portions before
 * the split lands — physical dims differ for both because they're
 * literally new packages.
 */
function PartialPackagingBlock({
  title,
  pkg,
  onChange,
}: {
  title: string;
  pkg: {
    length_mm: string;
    width_mm: string;
    height_mm: string;
    weight_kg: string;
    stack_factor: string;
  };
  onChange: (next: typeof pkg) => void;
}) {
  function patch(field: keyof typeof pkg, value: string) {
    onChange({ ...pkg, [field]: value });
  }

  return (
    <div className="space-y-2 rounded-md border border-border/60 bg-background px-3 py-2">
      <Label className="text-xs">{title}</Label>
      <p className="text-[10px] text-muted-foreground">
        Physical dimensions of the bag / drum / box — these drive the
        warehouse fit-check on the next move. Package weight is the
        gross weight (container + contents), separate from the
        contents qty above.
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <DimensionMmInput
          label="Length"
          value={pkg.length_mm}
          onChange={(v) => patch("length_mm", v)}
        />
        <DimensionMmInput
          label="Width"
          value={pkg.width_mm}
          onChange={(v) => patch("width_mm", v)}
        />
        <DimensionMmInput
          label="Height"
          value={pkg.height_mm}
          onChange={(v) => patch("height_mm", v)}
        />
        <PackInput
          label="Package weight, gross (kg)"
          value={pkg.weight_kg}
          onChange={(v) => patch("weight_kg", v)}
        />
        <PackInput
          label="Stack factor"
          value={pkg.stack_factor}
          onChange={(v) => patch("stack_factor", v)}
        />
      </div>
      <PackBoxPreview
        lengthMm={Number(pkg.length_mm) || 0}
        widthMm={Number(pkg.width_mm) || 0}
        heightMm={Number(pkg.height_mm) || 0}
        stack={Number(pkg.stack_factor) || 1}
      />
    </div>
  );
}

function PackInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px]">{label}</Label>
      <Input
        type="number"
        step="any"
        min={0}
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9"
      />
    </div>
  );
}

function Spec({
  label,
  value,
  unit,
}: {
  label: string;
  value: string | number | null;
  unit: string;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="text-sm">
        {value ?? "—"} <span className="text-muted-foreground">{unit}</span>
      </p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border/60 px-4 py-12 text-center">
      <CheckCheck className="size-7 text-emerald-500/70" />
      <div className="space-y-1">
        <p className="text-sm font-semibold">Nothing to inspect</p>
        <p className="text-xs text-muted-foreground">
          When a production run finishes, the output lots land here for
          a pass / fail verdict before they can transfer to the warehouse.
        </p>
      </div>
      <div className="flex max-w-md items-start gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-left text-[11px] text-muted-foreground">
        <AlertTriangle className="mt-0.5 size-3 shrink-0" />
        <p>
          A lot at `qc_failed` stays out of the warehouse until an
          investigation reroutes or disposes it via the lot-events
          ledger.
        </p>
      </div>
    </div>
  );
}

/**
 * Compute whether Output QC (both Pass and Fail) is blocked by
 * NPD's product validation. Mirrors the server rule at
 * `Backend.Production.guard_npd_validation_gate/2` — the guard
 * fires for any MO with a linked NPD trial batch (`npd_trial_batch_uuid`
 * set) regardless of whether the MO is stamped `project_type=trial`
 * (R&D bench-scale) or `project_type=sample` (Custom-flow trial-
 * batch sample). Both flavours produce a physical run whose
 * output needs the ProductValidation form filled + signed on NPD
 * before QA can accept the lot.
 *
 * RTG sample-kit MOs carry `project_type=sample` too but with
 * `npd_trial_batch_uuid = NULL` — those are pre-validated
 * commercial-catalogue runs and correctly skip the gate.
 *
 * FE also blocks the Fail button (not just Pass) so the operator's
 * mental model matches: "finish the validation form first, THEN
 * approve or reject." The backend's Fail path today doesn't enforce
 * the gate (an operator can always fail a broken lot via direct
 * API), but the UX defaults to the sequential guidance the
 * scientists rely on. If a legit "fail without validation" surfaces
 * we can add an escape hatch — for now, the wizard's linear.
 *
 * `failed` is a distinct terminal case: the lot has already been
 * auto-rejected by the webhook, so both buttons being locked is
 * academic — the failure banner in `NpdValidationCard` explains
 * what's next.
 */
function computeNpdGate(
  mo: OutputQcEntry["mo"],
): { blocked: boolean; reason?: string } {
  if (!mo) return { blocked: false };
  if (!mo.npd_trial_batch_uuid) {
    return { blocked: false };
  }
  // RTG projects don't do per-batch validation — the RTG's FINAL-spec
  // approval flow is the recipe-validation gate. Every batch on RTG
  // is either an internal test of an already-validated recipe or
  // customer-sample fulfilment, neither of which is a per-batch
  // validation step. Matches the ``NpdValidationCard`` render gate.
  if (mo.npd_project_type === "ready_to_go") return { blocked: false };
  const status = mo.npd_validation_status;
  if (status === "passed") return { blocked: false };

  const label =
    status === "failed"
      ? "failed"
      : status === "in_progress"
        ? "in progress"
        : status === "draft"
          ? "draft"
          : "not started";

  return {
    blocked: true,
    reason: `Waiting for NPD product validation to pass. Current status: ${label}. Fill and sign the trial batch validation form on NPD before Pass / Fail unlock.`,
  };
}
