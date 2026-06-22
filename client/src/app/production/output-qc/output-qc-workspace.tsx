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
  const uomSymbol = lot.uom?.symbol ?? "ea";

  function pass() {
    setError(null);
    startTransition(async () => {
      const res = await signOffOutputQcAction(lot.uuid, "pass", null);
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
    setError(null);
    startTransition(async () => {
      const res = await signOffOutputQcAction(lot.uuid, "fail", reason);
      if (res.ok) {
        toast.success("QC failed — lot flagged");
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
        <div className="space-y-1.5 rounded-md border border-rose-500/40 bg-rose-500/5 px-3 py-3">
          <Label htmlFor={`qc-reason-${lot.uuid}`} className="text-xs">
            Reason for failing this lot
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
          <button
            type="button"
            className="text-[11px] text-muted-foreground hover:text-foreground"
            onClick={() => {
              setMode("idle");
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
