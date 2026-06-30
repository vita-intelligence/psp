"use client";

/**
 * Per-MO production-run page. Reuses the canonical MO detail
 * sections (`MOPartsTable`, `MOOperationsTable`, `MOCostSummary`,
 * `MOChainRoadmap`) so the operator sees the same layout they're
 * already familiar with from the MO ledger — just with the run-
 * specific Start / Finish controls and the production-feed cell
 * floor-plan overlay layered on top.
 */

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Factory,
  Layers,
  Loader2,
  MapPin,
  Package,
  PackageOpen,
  Play,
  Truck,
  Workflow,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorBanner } from "@/components/forms/error-banner";
import { FloorPlanMini } from "@/components/warehouses/floor-plan-mini";
import { PackBoxPreview } from "@/components/packaging/pack-box-preview";
import { cn } from "@/lib/utils";
import { formatCompanyDate } from "@/lib/format/company";
import type { CompanyDefaults } from "@/lib/types";
import {
  finishProductionAction,
  startProductionAction,
} from "@/lib/production-run/actions";
import type { ManufacturingOrder } from "@/lib/production/types";
import { MOCostSummary } from "../../manufacturing-orders/mo-cost-summary";
import { MOPartsTable } from "../../manufacturing-orders/mo-parts-table";
import { MOOperationsTable } from "../../manufacturing-orders/mo-operations-table";
import { MOChainRoadmap } from "../../manufacturing-orders/mo-chain-roadmap";

interface Props {
  initialMo: ManufacturingOrder;
  company: CompanyDefaults;
}

interface PackRow {
  qty: string;
  length_mm: string;
  width_mm: string;
  height_mm: string;
  weight_kg: string;
  stack_factor: string;
}

export function ProductionRunDetail({ initialMo, company }: Props) {
  const router = useRouter();
  const [mo, setMo] = useState<ManufacturingOrder>(initialMo);
  const [pending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);
  const [finishOpen, setFinishOpen] = useState(false);

  const stage = stageOf(mo);
  const uomSymbol = mo.item?.stock_uom?.symbol ?? "ea";

  function onStart() {
    setActionError(null);
    startTransition(async () => {
      const res = await startProductionAction(mo.uuid);
      if (res.ok) {
        toast.success("Production started");
        setMo(res.mo);
        router.refresh();
      } else {
        setActionError(res.detail);
      }
    });
  }

  function onFinished(updated: ManufacturingOrder) {
    setMo(updated);
    setFinishOpen(false);
    toast.success("Production finished");
    router.refresh();
  }

  return (
    <section className="space-y-6">
      <StageBanner stage={stage} />

      {actionError && <ErrorBanner detail={actionError} />}

      <RunControlsCard
        mo={mo}
        stage={stage}
        uomSymbol={uomSymbol}
        pending={pending}
        onStart={onStart}
        onOpenFinish={() => setFinishOpen(true)}
      />

      <ContextGrid mo={mo} company={company} />

      <ProductionCellPanel mo={mo} />

      {/* Canonical MO detail sections — exact same look + behaviour as
          /production/manufacturing-orders/[uuid] so operators are not
          learning a second layout. canEdit=false because the Run tab
          is read-only from a structural-edit perspective. */}
      <MOChainRoadmap mo={mo} company={company} />
      <MOCostSummary mo={mo} company={company} />
      <MOPartsTable mo={mo} company={company} canEdit={false} />
      <MOOperationsTable mo={mo} company={company} canEdit={false} />

      <FinishDialog
        open={finishOpen}
        onOpenChange={setFinishOpen}
        mo={mo}
        uomSymbol={uomSymbol}
        onFinished={onFinished}
      />
    </section>
  );
}

function ContextGrid({
  mo,
  company,
}: {
  mo: ManufacturingOrder;
  company: CompanyDefaults;
}) {
  const picker = mo.pickup_completed_by?.name ?? "—";

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <ContextCard label="Materials arrived" icon={Truck}>
        {mo.pickup_completed_at ? (
          <>
            <p className="text-sm">
              {formatCompanyDate(mo.pickup_completed_at, company)}
            </p>
            <p className="text-[11px] text-muted-foreground">
              Picker: {picker}
            </p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            Waiting for warehouse picker.
          </p>
        )}
      </ContextCard>

      <ContextCard label="Production-feed cell" icon={Package}>
        {mo.production_cell ? (
          <>
            <p className="text-sm">
              {mo.production_cell.storage_location?.code ??
                mo.production_cell.storage_location?.name ??
                mo.production_cell.name ??
                `Cell #${mo.production_cell.id}`}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {mo.production_cell.storage_location?.floor?.warehouse?.name ??
                "—"}{" "}
              · {mo.production_cell.storage_location?.floor?.name ?? "—"}
            </p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            Picker hasn&apos;t confirmed transfer yet.
          </p>
        )}
      </ContextCard>

      <ContextCard label="Planned" icon={Workflow}>
        <p className="text-sm">
          {mo.start_at
            ? `${formatCompanyDate(mo.start_at, company)} → ${formatCompanyDate(mo.finish_at, company)}`
            : "Not scheduled"}
        </p>
      </ContextCard>

      <ContextCard label="Run times" icon={Factory}>
        {mo.actual_start ? (
          <p className="text-sm">
            {formatCompanyDate(mo.actual_start, company)}
            {mo.actual_finish
              ? ` → ${formatCompanyDate(mo.actual_finish, company)}`
              : " → running"}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Hasn&apos;t started yet.
          </p>
        )}
      </ContextCard>
    </div>
  );
}

function ContextCard({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card p-3 shadow-sm">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className="size-3" />
        {label}
      </div>
      <div className="mt-1 space-y-0.5">{children}</div>
    </div>
  );
}

type Stage = "preflight_pending" | "ready" | "running" | "completed" | "other";

function stageOf(mo: ManufacturingOrder): Stage {
  if (mo.status === "completed") return "completed";
  if (mo.status === "in_progress") return "running";
  if (mo.status === "scheduled" && mo.pickup_completed_at) return "ready";
  if (mo.status === "scheduled") return "preflight_pending";
  return "other";
}

function StageBanner({ stage }: { stage: Stage }) {
  if (stage === "preflight_pending") {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
        <ClipboardCheck className="mt-0.5 size-4 shrink-0" />
        <div>
          <p className="font-medium">Pre-production still pending</p>
          <p className="text-[12px] opacity-80">
            Materials need to arrive at the production-feed cell and be
            signed off per booking before this MO can start.
          </p>
        </div>
      </div>
    );
  }

  if (stage === "running") {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
        <Factory className="mt-0.5 size-4 shrink-0" />
        <div>
          <p className="font-medium">Currently running on the floor</p>
        </div>
      </div>
    );
  }

  if (stage === "completed") {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-900 dark:text-emerald-200">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
        <div>
          <p className="font-medium">Production complete</p>
          <p className="text-[12px] opacity-80">
            Output lot created at the production-feed cell, status{" "}
            <code className="mx-0.5 rounded bg-emerald-500/20 px-1 py-0.5 text-[10px]">
              received
            </code>
            . Operators can now run the post-production return on
            mobile to move materials back to the warehouse.
          </p>
        </div>
      </div>
    );
  }

  if (stage === "ready") {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-sky-500/40 bg-sky-500/10 px-4 py-3 text-sm text-sky-900 dark:text-sky-200">
        <PackageOpen className="mt-0.5 size-4 shrink-0" />
        <div>
          <p className="font-medium">Ready to start</p>
          <p className="text-[12px] opacity-80">
            Every booking is signed off. Materials are at the
            production-feed cell.
          </p>
        </div>
      </div>
    );
  }

  return null;
}

function RunControlsCard({
  mo,
  stage,
  uomSymbol,
  pending,
  onStart,
  onOpenFinish,
}: {
  mo: ManufacturingOrder;
  stage: Stage;
  uomSymbol: string;
  pending: boolean;
  onStart: () => void;
  onOpenFinish: () => void;
}) {
  return (
    <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">
            Run controls
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {stage === "ready"
              ? "Tap Start when you begin physical production."
              : stage === "running"
                ? "Tap Finish when the run is done — you'll enter the produced quantity and actual finish time."
                : stage === "completed"
                  ? "Run complete. Head to the post-production return on a mobile device to send materials back."
                  : "Preflight is still in progress — head to Pre-production to sign off every booking first."}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {stage === "completed" && (
            <div className="text-sm">
              <span className="font-medium">
                {mo.quantity_produced ?? "—"} {uomSymbol}
              </span>{" "}
              <span className="text-muted-foreground">produced</span>
            </div>
          )}
          {stage === "ready" && (
            <Button onClick={onStart} disabled={pending}>
              {pending && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
              <Play className="mr-1.5 size-3.5" />
              Start production
            </Button>
          )}
          {stage === "running" && (
            <Button onClick={onOpenFinish} disabled={pending}>
              <CheckCircle2 className="mr-1.5 size-3.5" />
              Finish production
            </Button>
          )}
          {stage === "completed" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="size-2.5" />
              Completed
            </span>
          )}
        </div>
      </header>
    </section>
  );
}

function ProductionCellPanel({ mo }: { mo: ManufacturingOrder }) {
  const cell = mo.production_cell;
  if (!cell) return null;

  const loc = cell.storage_location;
  const isSystemCell = !!cell.system_kind;

  return (
    <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      <header className="mb-3">
        <h2 className="text-sm font-semibold tracking-tight">
          Where the materials are
        </h2>
        <p className="text-xs text-muted-foreground">
          Highlighted rack on the floor plan — that&apos;s the
          production-feed cell the picker dropped the ingredients on.
        </p>
      </header>

      {isSystemCell ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <p>
            This is a system cell (no floor plan). Find materials by name
            at the {cell.name ?? "receiving / staging"} zone.
          </p>
        </div>
      ) : (
        loc?.floor?.uuid &&
        loc?.uuid && (
          <FloorPlanMini
            floorUuid={loc.floor.uuid}
            targetLocationUuid={loc.uuid}
            apiPath={(uuid) =>
              `/api/stock/floors/${encodeURIComponent(uuid)}/plan`
            }
          />
        )
      )}

      <ol className="mt-3 grid gap-2 sm:grid-cols-2">
        <DirectionsRow
          icon={Building2}
          label="Warehouse"
          value={loc?.floor?.warehouse?.name ?? "—"}
        />
        <DirectionsRow
          icon={Layers}
          label="Floor"
          value={loc?.floor?.name ?? "—"}
        />
        <DirectionsRow
          icon={MapPin}
          label="Location"
          value={loc?.code ?? loc?.name ?? "—"}
          suffix={loc?.code && loc?.name ? loc.name : null}
        />
        <DirectionsRow
          icon={Package}
          label="Cell"
          value={cell.name ?? `Cell #${cell.id}`}
          suffix={
            cell.ordinal !== null && cell.ordinal !== undefined
              ? `Level ${cell.ordinal + 1}`
              : null
          }
        />
      </ol>
    </section>
  );
}

function DirectionsRow({
  icon: Icon,
  label,
  value,
  suffix,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  suffix?: string | null;
}) {
  return (
    <li className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
      <Icon className="mt-0.5 size-3.5 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p className="truncate text-sm">{value}</p>
        {suffix && (
          <p className="truncate text-xs text-muted-foreground">{suffix}</p>
        )}
      </div>
    </li>
  );
}

function FinishDialog({
  open,
  onOpenChange,
  mo,
  uomSymbol,
  onFinished,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mo: ManufacturingOrder;
  uomSymbol: string;
  onFinished: (updated: ManufacturingOrder) => void;
}) {
  const defaultStart = useMemo(
    () => mo.actual_start ?? null,
    [mo.actual_start],
  );
  const [qty, setQty] = useState<string>(mo.quantity);
  const [startLocal, setStartLocal] = useState<string>(
    defaultStart
      ? toLocalInput(defaultStart)
      : toLocalInput(new Date().toISOString()),
  );
  const [finishLocal, setFinishLocal] = useState<string>(
    toLocalInput(new Date().toISOString()),
  );

  // The dialog is mounted on page load (parent toggles `open`), so
  // `useState`'s initialiser only runs once — with the page-load
  // value of `mo.actual_start`. When the operator taps Start, the
  // parent refreshes the MO and `mo.actual_start` populates, but
  // `startLocal` would otherwise stay at the page-load "now".
  // Re-sync from `mo.actual_start` (and finish to fresh now) every
  // time the dialog opens so the prefilled values reflect the
  // real Start stamp the BE recorded.
  useEffect(() => {
    if (!open) return;
    setStartLocal(
      defaultStart
        ? toLocalInput(defaultStart)
        : toLocalInput(new Date().toISOString()),
    );
    setFinishLocal(toLocalInput(new Date().toISOString()));
  }, [open, defaultStart]);
  // Per-pack output rows. Each pack becomes one output stock_lot —
  // 1 pack by default (the common "all the powder ended up in one
  // sack" case), operator can + Add pack to split. Sum of pack qtys
  // must equal Produced qty before submit.
  const [packs, setPacks] = useState<PackRow[]>(() => [
    {
      qty: mo.quantity,
      length_mm: "",
      width_mm: "",
      height_mm: "",
      weight_kg: "",
      stack_factor: "1",
    },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const operations = useMemo(
    () =>
      (mo.operations ?? [])
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order),
    [mo.operations],
  );

  // Default proportion per op = relative cycle*qty + setup, falling
  // back to equal split when nothing's set. Numbers are stored as
  // fractions of the total run, then converted to per-op datetimes
  // at submit. Slider sums always equal 1 (the divider rebalances on
  // every drag so a 3-way split stays 100%).
  const [proportions, setProportions] = useState<number[]>(() =>
    defaultProportions(mo),
  );

  const totalMs = useMemo(() => {
    const s = fromLocalInput(startLocal);
    const f = fromLocalInput(finishLocal);
    if (!s || !f) return 0;
    return Math.max(0, new Date(f).getTime() - new Date(s).getTime());
  }, [startLocal, finishLocal]);

  function submit() {
    setError(null);
    const qtyNum = Number(qty.trim());
    if (qty.trim() === "" || Number.isNaN(qtyNum) || qtyNum < 0) {
      setError("Produced quantity must be zero or greater.");
      return;
    }
    const start = fromLocalInput(startLocal);
    const finish = fromLocalInput(finishLocal);
    if (!start || !finish) {
      setError("Pick a valid start and finish time.");
      return;
    }
    if (new Date(finish) < new Date(start)) {
      setError("Finish time can't be earlier than start time.");
      return;
    }
    // Packs — every row's fields must be positive; sum of qtys must
    // match the produced qty so the BE ledger balances.
    if (packs.length === 0) {
      setError("Add at least one pack before finishing.");
      return;
    }
    let packSum = 0;
    for (const [idx, p] of packs.entries()) {
      const checks: Array<[string, string]> = [
        ["qty", p.qty],
        ["length (mm)", p.length_mm],
        ["width (mm)", p.width_mm],
        ["height (mm)", p.height_mm],
        ["weight (kg)", p.weight_kg],
        ["stack factor", p.stack_factor],
      ];
      for (const [label, val] of checks) {
        const n = Number(val.trim());
        if (val.trim() === "" || Number.isNaN(n) || n <= 0) {
          setError(`Pack ${idx + 1}: ${label} must be a positive number.`);
          return;
        }
      }
      if (Number(p.stack_factor.trim()) > 50) {
        setError(`Pack ${idx + 1}: stack factor can't exceed 50.`);
        return;
      }
      packSum += Number(p.qty.trim());
    }
    if (Math.abs(packSum - qtyNum) > 0.0001) {
      setError(
        `Pack quantities sum to ${packSum} but produced qty is ${qtyNum}.`,
      );
      return;
    }
    const startMs = new Date(start).getTime();
    const totalSpan = new Date(finish).getTime() - startMs;
    let cursorMs = 0;
    const opTimes = operations.map((op, idx) => {
      const segMs = idx === operations.length - 1
        ? totalSpan - cursorMs
        : Math.round(totalSpan * proportions[idx]);
      const s = new Date(startMs + cursorMs).toISOString();
      const f = new Date(startMs + cursorMs + segMs).toISOString();
      cursorMs += segMs;
      return {
        step_uuid: op.uuid,
        actual_start: s,
        actual_finish: f,
      };
    });

    startTransition(async () => {
      const res = await finishProductionAction(mo.uuid, {
        actual_start: start,
        actual_finish: finish,
        quantity_produced: qty.trim(),
        operation_times: opTimes,
        packs: packs.map((p) => ({
          qty: p.qty.trim(),
          length_mm: p.length_mm.trim(),
          width_mm: p.width_mm.trim(),
          height_mm: p.height_mm.trim(),
          weight_kg: p.weight_kg.trim(),
          stack_factor: p.stack_factor.trim(),
        })),
      });
      if (res.ok) {
        onFinished(res.mo);
      } else {
        setError(res.detail);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b border-border/60 px-6 py-4">
          <DialogTitle>Finish production</DialogTitle>
          <DialogDescription>
            Stamps the actual start / finish times + produced quantity,
            then auto-creates the output stock lot at the
            production-feed cell. The divider below splits the total
            run time across operations — drag a boundary to give a
            step more or less of the span.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="finish-start" className="text-xs">
                Actual start
              </Label>
              <Input
                id="finish-start"
                type="datetime-local"
                value={startLocal}
                onChange={(e) => setStartLocal(e.target.value)}
                className="h-10"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="finish-finish" className="text-xs">
                Actual finish
              </Label>
              <Input
                id="finish-finish"
                type="datetime-local"
                value={finishLocal}
                onChange={(e) => setFinishLocal(e.target.value)}
                className="h-10"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="finish-qty" className="text-xs">
              Produced quantity ({uomSymbol})
            </Label>
            <Input
              id="finish-qty"
              type="number"
              step="any"
              min={0}
              inputMode="decimal"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="h-10"
            />
            <p className="text-[11px] text-muted-foreground">
              Planned: {mo.quantity} {uomSymbol}. Enter the actual output
              — drift between planned and produced is queryable later.
            </p>
          </div>

          <PacksEditor
            packs={packs}
            onChange={setPacks}
            uomSymbol={uomSymbol}
            totalQty={qty}
          />

          {operations.length > 0 && totalMs > 0 && (
            <OperationTimeDivider
              operations={operations}
              proportions={proportions}
              onChange={setProportions}
              totalMs={totalMs}
            />
          )}

          {error && <ErrorBanner detail={error} />}
        </div>

        <DialogFooter className="shrink-0 border-t border-border/60 bg-background px-6 py-3">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={pending}>
            {pending && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
            Confirm finish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Horizontal segmented bar — one segment per operation, separated by
 * draggable boundary handles. Drag a handle to move time between
 * the segment on its left and the one on its right; the rest stay
 * locked. `proportions` always sums to 1 ± a tiny float epsilon.
 */
function OperationTimeDivider({
  operations,
  proportions,
  onChange,
  totalMs,
}: {
  operations: ManufacturingOrder["operations"];
  proportions: number[];
  onChange: (next: number[]) => void;
  totalMs: number;
}) {
  // Tailwind-y palette cycled per segment for visual separation.
  // Indexed mod N so even very long routings stay readable.
  const palette = [
    "bg-sky-500/70",
    "bg-violet-500/70",
    "bg-emerald-500/70",
    "bg-amber-500/70",
    "bg-rose-500/70",
    "bg-cyan-500/70",
  ];

  // Track ref + active-handle state so the handle can highlight while
  // dragging. Pointer events bind to window so a fast swipe past the
  // bar edge still moves the boundary instead of dropping the gesture.
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [activeBoundary, setActiveBoundary] = useState<number | null>(null);

  function startDrag(boundaryIdx: number, e: React.PointerEvent<HTMLDivElement>) {
    const track = trackRef.current;
    if (!track) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    setActiveBoundary(boundaryIdx);

    const leftSum = proportions
      .slice(0, boundaryIdx)
      .reduce((a, b) => a + b, 0);
    const combined = proportions[boundaryIdx] + proportions[boundaryIdx + 1];

    function move(ev: PointerEvent) {
      const rect = track!.getBoundingClientRect();
      const pct = Math.min(
        1,
        Math.max(0, (ev.clientX - rect.left) / rect.width),
      );
      // The boundary lives between [leftSum, leftSum + combined].
      // Clamp to keep both adjacent segments at least 1% so handles
      // never collapse on top of each other.
      const shareLeft = Math.min(
        combined - 0.01,
        Math.max(0.01, pct - leftSum),
      );
      const next = proportions.slice();
      next[boundaryIdx] = shareLeft;
      next[boundaryIdx + 1] = combined - shareLeft;
      onChange(next);
    }

    function up() {
      setActiveBoundary(null);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    }

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  // Keyboard nudge: ±5% on the boundary for fine adjustments without
  // a mouse. Arrow keys when the handle has focus.
  function nudge(boundaryIdx: number, deltaPct: number) {
    const leftSum = proportions
      .slice(0, boundaryIdx)
      .reduce((a, b) => a + b, 0);
    const combined = proportions[boundaryIdx] + proportions[boundaryIdx + 1];
    const current = leftSum + proportions[boundaryIdx];
    const target = Math.min(
      leftSum + combined - 0.01,
      Math.max(leftSum + 0.01, current + deltaPct),
    );
    const shareLeft = target - leftSum;
    const next = proportions.slice();
    next[boundaryIdx] = shareLeft;
    next[boundaryIdx + 1] = combined - shareLeft;
    onChange(next);
  }

  return (
    <div className="space-y-2 rounded-lg border border-border/60 bg-muted/30 p-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs">Operation time allocation</Label>
        <span className="text-[11px] text-muted-foreground">
          Total: {formatMs(totalMs)}
        </span>
      </div>

      <div
        ref={trackRef}
        className="relative h-12 overflow-visible rounded-md bg-background ring-1 ring-border/60 select-none"
      >
        <div className="flex h-full w-full overflow-hidden rounded-md">
          {operations.map((op, idx) => {
            const ms = totalMs * proportions[idx];
            return (
              <div
                key={op.uuid}
                style={{ width: `${proportions[idx] * 100}%` }}
                className={`flex items-center justify-center overflow-hidden text-[11px] font-semibold text-white ${palette[idx % palette.length]}`}
                title={`Step ${op.sort_order + 1} — ${formatMs(ms)}`}
              >
                {proportions[idx] > 0.06 && (
                  <span className="truncate px-1">
                    {op.sort_order + 1}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Draggable boundary handles — visible pill that sticks above
            and below the bar so the grip area is obvious and easy to
            grab on touch / trackpads. Hover + active state expand the
            pill so the operator gets visual confirmation. */}
        {operations.slice(0, -1).map((_, idx) => {
          const left = proportions
            .slice(0, idx + 1)
            .reduce((a, b) => a + b, 0);
          const isActive = activeBoundary === idx;
          return (
            <div
              key={`boundary-${idx}`}
              role="separator"
              aria-orientation="vertical"
              aria-label={`Divider between step ${idx + 1} and ${idx + 2}`}
              aria-valuenow={Math.round(left * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              tabIndex={0}
              onPointerDown={(e) => startDrag(idx, e)}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft") {
                  e.preventDefault();
                  nudge(idx, -0.02);
                } else if (e.key === "ArrowRight") {
                  e.preventDefault();
                  nudge(idx, 0.02);
                }
              }}
              style={{ left: `${left * 100}%` }}
              className={cn(
                "group absolute -top-1 z-20 flex h-[calc(100%+0.5rem)] -translate-x-1/2 cursor-ew-resize touch-none flex-col items-center justify-center outline-none",
                isActive ? "scale-110" : "",
              )}
            >
              {/* Visible grip pill: 12px wide w/ rounded ends and two
                  vertical grip lines so the affordance reads even at
                  a glance. Larger transparent hit zone surrounds it
                  for easy touch targeting. */}
              <div
                className={cn(
                  "pointer-events-none flex h-full w-3 items-center justify-center rounded-full border bg-white shadow transition-colors",
                  isActive
                    ? "border-foreground"
                    : "border-border/80 group-hover:border-foreground/60 group-focus-visible:border-foreground",
                )}
              >
                <div className="flex flex-col gap-0.5">
                  <span className="h-2 w-px bg-foreground/60" />
                  <span className="h-2 w-px bg-foreground/60" />
                </div>
              </div>
              {/* Live readout above the handle while dragging so the
                  operator sees the percentages snap in real time. */}
              {isActive && (
                <div className="pointer-events-none absolute -top-6 whitespace-nowrap rounded bg-foreground px-1.5 py-0.5 text-[10px] font-medium text-background shadow">
                  {Math.round(proportions[idx] * 100)}% ·{" "}
                  {Math.round(proportions[idx + 1] * 100)}%
                </div>
              )}
            </div>
          );
        })}
      </div>

      <ul className="space-y-1">
        {operations.map((op, idx) => {
          const ms = totalMs * proportions[idx];
          return (
            <li
              key={op.uuid}
              className="flex items-center justify-between gap-2 text-[11px]"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={`size-2.5 shrink-0 rounded-sm ${palette[idx % palette.length]}`}
                />
                <span className="truncate text-muted-foreground">
                  <span className="font-mono">Step {op.sort_order + 1}</span>
                  {op.operation_description && (
                    <span className="ml-1 text-foreground/80">
                      · {op.operation_description.slice(0, 60)}
                      {op.operation_description.length > 60 ? "…" : ""}
                    </span>
                  )}
                </span>
              </div>
              <span className="shrink-0 font-mono text-foreground">
                {formatMs(ms)}{" "}
                <span className="text-muted-foreground">
                  ({Math.round(proportions[idx] * 100)}%)
                </span>
              </span>
            </li>
          );
        })}
      </ul>

      <p className="text-[10px] text-muted-foreground">
        Grab the white handles between segments and drag left / right
        to redistribute time. Arrow keys nudge ±2 %. The last step
        absorbs rounding so the total always equals the run span.
      </p>
    </div>
  );
}

/**
 * Per-pack editor — mirrors the PO-receive dialog's "one row per
 * physical package" shape. `qty` is in the item's stock UoM (kg,
 * each, etc.); the BE sets `units_per_package = qty` on each output
 * lot so volume math always sees 1 package per lot. Hides the
 * `units_per_package` field from the operator entirely to avoid the
 * 25 kg→625 kg multiplier confusion from earlier.
 */
function PacksEditor({
  packs,
  onChange,
  uomSymbol,
  totalQty,
}: {
  packs: PackRow[];
  onChange: (next: PackRow[]) => void;
  uomSymbol: string;
  totalQty: string;
}) {
  const sum = packs.reduce((acc, p) => acc + (Number(p.qty) || 0), 0);
  const total = Number(totalQty) || 0;
  const mismatch =
    total > 0 && Math.abs(sum - total) > 0.0001;

  function patch(idx: number, fields: Partial<PackRow>) {
    onChange(packs.map((p, i) => (i === idx ? { ...p, ...fields } : p)));
  }

  function add() {
    const remaining = Math.max(0, total - sum);
    onChange([
      ...packs,
      {
        qty: remaining > 0 ? String(remaining) : "",
        length_mm: "",
        width_mm: "",
        height_mm: "",
        weight_kg: "",
        stack_factor: "1",
      },
    ]);
  }

  function remove(idx: number) {
    if (packs.length === 1) return;
    onChange(packs.filter((_, i) => i !== idx));
  }

  // Cross-check tone — mirrors the goods-in wizard's "Ordered vs
  // Received so far" sticky card so the operator always sees how
  // close their pack qtys are to the produced total while scrolling.
  const matched = total > 0 && !mismatch;
  const overProduced = sum > total;
  const shortBy = Math.max(0, total - sum);
  const overBy = Math.max(0, sum - total);

  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 p-3 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <Label className="text-xs">Output packages</Label>
          <p className="text-[11px] text-muted-foreground">
            One row per physical package (box / bag / drum) the operator
            filled. Each row becomes its own output lot. Sum of qtys
            must equal Produced quantity.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={add}>
          + Add pack
        </Button>
      </div>

      {/* Sticky cross-check — Produced vs Sum of pack qtys. Same
          pattern as the goods-in wizard's per-line header so the
          operator keeps the target qty in sight while filling
          pack-by-pack. */}
      <div className="sticky top-0 z-10 space-y-2 rounded-md border border-border/60 bg-background/95 p-3 shadow-sm backdrop-blur">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Produced
            </p>
            <p className="text-xl font-bold tabular-nums leading-tight">
              {total}
              {uomSymbol ? (
                <span className="ml-1 text-xs font-medium text-muted-foreground">
                  {uomSymbol}
                </span>
              ) : null}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Packed so far
            </p>
            <p
              className={cn(
                "text-xl font-bold tabular-nums leading-tight",
                matched
                  ? "text-emerald-700 dark:text-emerald-400"
                  : overProduced
                    ? "text-amber-700 dark:text-amber-300"
                    : "text-foreground",
              )}
            >
              {sum}
              {uomSymbol ? (
                <span className="ml-1 text-xs font-medium text-muted-foreground">
                  {uomSymbol}
                </span>
              ) : null}
            </p>
          </div>
        </div>
        {matched ? (
          <p className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
            Matches the produced quantity — ready to finish.
          </p>
        ) : overProduced ? (
          <p className="text-[11px] font-medium text-amber-700 dark:text-amber-300">
            Over by {overBy}
            {uomSymbol ? ` ${uomSymbol}` : ""} — drop a pack or trim a qty.
          </p>
        ) : total > 0 ? (
          <p className="text-[11px] text-muted-foreground">
            Still short by {shortBy}
            {uomSymbol ? ` ${uomSymbol}` : ""}.
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Enter Produced quantity above to compare against pack totals.
          </p>
        )}
      </div>

      <ul className="space-y-2">
        {packs.map((pack, idx) => (
          <li
            key={idx}
            className="rounded-md border border-border/60 bg-background p-3"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold text-muted-foreground">
                Pack {idx + 1}
              </span>
              {packs.length > 1 && (
                <button
                  type="button"
                  onClick={() => remove(idx)}
                  className="text-[11px] text-muted-foreground hover:text-destructive"
                >
                  Remove
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <div className="space-y-1">
                <Label className="text-[10px]">Qty ({uomSymbol})</Label>
                <Input
                  type="number"
                  step="any"
                  min={0}
                  inputMode="decimal"
                  value={pack.qty}
                  onChange={(e) => patch(idx, { qty: e.target.value })}
                  className="h-9"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Weight (kg)</Label>
                <Input
                  type="number"
                  step="any"
                  min={0}
                  inputMode="decimal"
                  placeholder="5.0"
                  value={pack.weight_kg}
                  onChange={(e) =>
                    patch(idx, { weight_kg: e.target.value })
                  }
                  className="h-9"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Stack factor</Label>
                <Input
                  type="number"
                  step="1"
                  min={1}
                  max={50}
                  inputMode="numeric"
                  value={pack.stack_factor}
                  onChange={(e) =>
                    patch(idx, { stack_factor: e.target.value })
                  }
                  className="h-9"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Length (mm)</Label>
                <Input
                  type="number"
                  step="any"
                  min={0}
                  inputMode="decimal"
                  placeholder="300"
                  value={pack.length_mm}
                  onChange={(e) =>
                    patch(idx, { length_mm: e.target.value })
                  }
                  className="h-9"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Width (mm)</Label>
                <Input
                  type="number"
                  step="any"
                  min={0}
                  inputMode="decimal"
                  placeholder="200"
                  value={pack.width_mm}
                  onChange={(e) =>
                    patch(idx, { width_mm: e.target.value })
                  }
                  className="h-9"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Height (mm)</Label>
                <Input
                  type="number"
                  step="any"
                  min={0}
                  inputMode="decimal"
                  placeholder="150"
                  value={pack.height_mm}
                  onChange={(e) =>
                    patch(idx, { height_mm: e.target.value })
                  }
                  className="h-9"
                />
              </div>
            </div>

            {/* Live 3D preview — same component the goods-in wizard
                uses. Operator can sanity-check L/W/H/stack as they
                type instead of guessing the units. */}
            <div className="mt-2">
              <PackBoxPreview
                lengthMm={Number(pack.length_mm) || 0}
                widthMm={Number(pack.width_mm) || 0}
                heightMm={Number(pack.height_mm) || 0}
                stack={Number(pack.stack_factor) || 1}
              />
            </div>
          </li>
        ))}
      </ul>

      {/* Duplicate "+ Add pack" at the BOTTOM of the list so the
          operator doesn't scroll back to the section header to add
          the next pack after filling the previous one. Keeps the
          flow linear: fill row → tap button right below → fill the
          new row that just appeared. */}
      <div className="flex justify-end">
        <Button type="button" variant="outline" size="sm" onClick={add}>
          + Add pack
        </Button>
      </div>

      <p className="text-[10px] text-muted-foreground">
        Stack factor = how many packs can safely stack on top of each
        other (1 = no stacking, 50 max).
      </p>
    </div>
  );
}

function defaultProportions(mo: ManufacturingOrder): number[] {
  const ops = (mo.operations ?? [])
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order);
  if (ops.length === 0) return [];

  // Use the planned duration (setup + cycle × qty) when available,
  // since the routing already worked that out. Falls back to equal
  // split when nothing's set.
  const weights = ops.map((op) => {
    if (op.planned_duration_seconds && op.planned_duration_seconds > 0) {
      return op.planned_duration_seconds;
    }
    const setup = Number(op.setup_time_min ?? 0) * 60;
    const cycle = Number(op.cycle_time_min ?? 0) * 60 * Number(mo.quantity ?? 0);
    const total = setup + cycle;
    return total > 0 ? total : 1;
  });

  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) {
    return ops.map(() => 1 / ops.length);
  }
  return weights.map((w) => w / sum);
}

function formatMs(ms: number): string {
  if (ms <= 0) return "0m";
  const totalMin = Math.round(ms / 60_000);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}
