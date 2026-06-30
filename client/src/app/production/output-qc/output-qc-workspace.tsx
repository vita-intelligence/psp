"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import {
  AlertTriangle,
  CheckCheck,
  CheckCircle2,
  Loader2,
  Microscope,
  Package,
  PackageOpen,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ErrorBanner } from "@/components/forms/error-banner";
import { PackBoxPreview } from "@/components/packaging/pack-box-preview";
import { cn } from "@/lib/utils";
import { formatCompanyDate, type FormatPrefs } from "@/lib/format/company";
import type { OutputQcEntry } from "@/lib/production/types";
import { signOffOutputQcAction } from "@/lib/production-output-qc/actions";

const POLL_INTERVAL_MS = 30_000;

interface Props {
  initialQueue: OutputQcEntry[];
  companyDateFormat: FormatPrefs | null;
}

export function OutputQcWorkspace({ initialQueue, companyDateFormat }: Props) {
  const [queue, setQueue] = useState<OutputQcEntry[]>(initialQueue);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setIsRefreshing(true);
    try {
      const res = await fetch("/api/production/output-qc", {
        cache: "no-store",
      });
      if (!res.ok) {
        if (!silent)
          setErrorDetail(`Couldn't refresh the queue (${res.status}).`);
        return;
      }
      const body = (await res.json()) as { items: OutputQcEntry[] };
      setQueue(body.items);
      if (!silent) setErrorDetail(null);
    } catch (err) {
      if (!silent)
        setErrorDetail(
          err instanceof Error ? err.message : "Network blip — try again.",
        );
    } finally {
      if (!silent) setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => void refresh(true), POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  function onSignedOff(uuid: string) {
    setQueue((prev) => prev.filter((e) => e.lot.uuid !== uuid));
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {queue.length === 0
            ? "Nothing awaiting QC."
            : `${queue.length} lot${queue.length === 1 ? "" : "s"} awaiting verdict`}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void refresh(false)}
          disabled={isRefreshing}
        >
          {isRefreshing ? (
            <Loader2 className="mr-1.5 size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="mr-1.5 size-3.5" />
          )}
          Refresh
        </Button>
      </div>

      {errorDetail && <ErrorBanner detail={errorDetail} />}

      {queue.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="space-y-3">
          {queue.map((entry) => (
            <QcCard
              key={entry.lot.uuid}
              entry={entry}
              companyDateFormat={companyDateFormat}
              onSignedOff={() => onSignedOff(entry.lot.uuid)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function QcCard({
  entry,
  companyDateFormat,
  onSignedOff,
}: {
  entry: OutputQcEntry;
  companyDateFormat: FormatPrefs | null;
  onSignedOff: () => void;
}) {
  const { lot, mo } = entry;
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"idle" | "fail">("idle");
  const [scope, setScope] = useState<"full" | "partial">("full");
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

  function pass() {
    setError(null);
    startTransition(async () => {
      const res = await signOffOutputQcAction(lot.uuid, "pass", { reason: null });
      if (res.ok) {
        toast.success("QC passed — lot now available");
        onSignedOff();
      } else {
        setError(res.detail);
      }
    });
  }

  function fail() {
    if (mode !== "fail") {
      setMode("fail");
      return;
    }
    if (!reason.trim()) {
      setError("Add a reason before failing the lot.");
      return;
    }

    if (scope === "partial") {
      const qtyNum = Number(rejectQty.trim());
      const fullQty = Number(lot.qty_received);
      if (!rejectQty.trim() || Number.isNaN(qtyNum) || qtyNum <= 0) {
        setError("Reject qty must be a positive number.");
        return;
      }
      if (qtyNum >= fullQty) {
        setError(
          `Reject qty must be less than the lot's ${fullQty} ${uomSymbol} — switch to Fail all to reject everything.`,
        );
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
            setError(
              `${label} packaging: ${field.replace("_", " ")} must be a positive number.`,
            );
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
        setError(res.detail);
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
          <p className="text-sm font-medium">
            {lot.item?.name ?? "Unknown item"}
          </p>
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
              disabled={pending}
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
              onClick={pass}
              disabled={pending}
            >
              {pending && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
              <CheckCircle2 className="mr-1.5 size-3.5" />
              Pass QC
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-4">
        <Spec label="Length" value={lot.package_length_mm} unit="mm" />
        <Spec label="Width" value={lot.package_width_mm} unit="mm" />
        <Spec label="Height" value={lot.package_height_mm} unit="mm" />
        <Spec label="Weight" value={lot.package_weight_kg} unit="kg" />
      </div>

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

      {error && <ErrorBanner detail={error} />}
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
        <PackInput
          label="Length (mm)"
          value={pkg.length_mm}
          onChange={(v) => patch("length_mm", v)}
        />
        <PackInput
          label="Width (mm)"
          value={pkg.width_mm}
          onChange={(v) => patch("width_mm", v)}
        />
        <PackInput
          label="Height (mm)"
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
