"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowRight,
  CheckCircle2,
  Loader2,
  PowerOff,
  Trash2,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge-mini";
import { ErrorBanner } from "@/components/forms/error-banner";
import { recordEquipmentEventAction } from "@/lib/equipment/actions";
import type { Equipment, EquipmentStatus } from "@/lib/equipment/types";
import { formatCompanyDate } from "@/lib/format/company";
import type { CompanyDefaults } from "@/lib/types";
import type { ErrorDebug } from "@/lib/errors/types";

const STATUS_LABEL: Record<EquipmentStatus, string> = {
  expected: "Expected",
  received: "Received",
  in_service: "In service",
  under_maintenance: "Under maintenance",
  out_for_repair: "Out for repair",
  awaiting_calibration: "Awaiting calibration",
  retired: "Retired",
  disposed: "Disposed",
  canceled: "Cancelled",
};

const STATUS_TONE: Record<
  EquipmentStatus,
  "muted" | "indigo" | "emerald" | "amber" | "destructive" | "brand"
> = {
  expected: "indigo",
  received: "indigo",
  in_service: "emerald",
  under_maintenance: "amber",
  out_for_repair: "amber",
  awaiting_calibration: "amber",
  retired: "muted",
  disposed: "muted",
  canceled: "muted",
};

// Which lifecycle actions are available from the current status.
// Kept as a client-side hint; the backend re-validates the transition
// through the allowed_transitions matrix and returns 422 on illegal
// moves, so this table is UX guidance rather than a security gate.
const ACTIONS_BY_STATUS: Record<
  EquipmentStatus,
  Array<{ kind: string; label: string; icon: typeof CheckCircle2 }>
> = {
  expected: [],
  received: [
    { kind: "in_service", label: "Put in service", icon: CheckCircle2 },
  ],
  in_service: [
    { kind: "maintenance_started", label: "Start maintenance", icon: Wrench },
    { kind: "calibrated", label: "Record calibration", icon: CheckCircle2 },
    { kind: "retired", label: "Retire", icon: PowerOff },
  ],
  under_maintenance: [
    {
      kind: "maintenance_completed",
      label: "Complete maintenance",
      icon: CheckCircle2,
    },
  ],
  out_for_repair: [
    {
      kind: "maintenance_completed",
      label: "Return from repair",
      icon: CheckCircle2,
    },
  ],
  awaiting_calibration: [
    { kind: "calibrated", label: "Record calibration", icon: CheckCircle2 },
  ],
  retired: [{ kind: "disposed", label: "Dispose", icon: Trash2 }],
  disposed: [],
  canceled: [],
};

interface Props {
  equipment: Equipment;
  canAct: boolean;
  prefs: CompanyDefaults;
}

export function EquipmentDetail({ equipment, canAct, prefs }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<{
    detail: string;
    code?: string;
    debug?: ErrorDebug;
  } | null>(null);
  const [reason, setReason] = useState("");
  const [openKind, setOpenKind] = useState<string | null>(null);

  const actions = ACTIONS_BY_STATUS[equipment.status] ?? [];

  function runAction(kind: string) {
    setError(null);
    startTransition(async () => {
      const res = await recordEquipmentEventAction(equipment.uuid, {
        kind,
        reason: reason.trim() || null,
      });
      if (res.ok) {
        toast.success(`Recorded ${kind.replace("_", " ")}`);
        setReason("");
        setOpenKind(null);
        router.refresh();
      } else {
        setError({ detail: res.detail, code: res.code, debug: res.debug });
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Identity + status */}
      <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Badge tone={STATUS_TONE[equipment.status]}>
                {STATUS_LABEL[equipment.status]}
              </Badge>
              {equipment.assigned_to && (
                <span className="text-xs text-muted-foreground">
                  Assigned to {equipment.assigned_to.name}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {equipment.manufacturer ?? "—"} · {equipment.model ?? "—"}
              {equipment.manufacturer_serial
                ? ` · OEM ${equipment.manufacturer_serial}`
                : ""}
            </p>
          </div>
          <div className="text-right text-xs">
            <p className="text-muted-foreground">Current cell</p>
            <p className="font-mono">
              {equipment.current_cell?.name ?? "—"}
            </p>
            {equipment.current_cell?.warehouse?.uuid && (
              <Link
                href={`/settings/warehouses/${equipment.current_cell.warehouse.uuid}`}
                className="mt-0.5 inline-block text-[10px] text-muted-foreground underline-offset-2 hover:underline"
              >
                {equipment.current_cell.warehouse.name}
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* Cadence card */}
      <section className="grid gap-3 sm:grid-cols-2">
        <CadenceCard
          label="Calibration"
          cadenceMonths={equipment.calibration_frequency_months}
          lastAt={equipment.last_calibrated_at}
          nextAt={equipment.next_calibration_at}
          prefs={prefs}
        />
        <CadenceCard
          label="Maintenance"
          cadenceMonths={equipment.maintenance_frequency_months}
          lastAt={equipment.last_maintenance_at}
          nextAt={equipment.next_maintenance_at}
          prefs={prefs}
        />
      </section>

      {/* Financials */}
      <section className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Unit cost"
          value={
            equipment.unit_cost
              ? `${equipment.currency ?? ""} ${equipment.unit_cost}`.trim()
              : "—"
          }
        />
        <StatCard
          label="Acquired"
          value={
            equipment.acquired_at
              ? formatCompanyDate(equipment.acquired_at, prefs)
              : "—"
          }
        />
        <StatCard
          label="Warranty ends"
          value={
            equipment.warranty_end_at
              ? formatCompanyDate(equipment.warranty_end_at, prefs)
              : "—"
          }
        />
      </section>

      {/* Actions */}
      {canAct && actions.length > 0 && (
        <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold">Actions</h2>

          {openKind ? (
            <div className="space-y-3">
              <div>
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Reason / notes (optional)
                </Label>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Attach an audit-friendly line…"
                  rows={2}
                />
              </div>
              {error && (
                <ErrorBanner
                  detail={error.detail}
                  code={error.code}
                  debug={error.debug}
                />
              )}
              <div className="flex items-center gap-2">
                <Button
                  onClick={() => runAction(openKind)}
                  disabled={pending}
                >
                  {pending ? (
                    <Loader2 className="mr-1.5 size-4 animate-spin" />
                  ) : (
                    <ArrowRight className="mr-1.5 size-4" />
                  )}
                  Confirm
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setOpenKind(null);
                    setReason("");
                    setError(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {actions.map((a) => (
                <Button
                  key={a.kind}
                  size="sm"
                  variant="outline"
                  onClick={() => setOpenKind(a.kind)}
                >
                  <a.icon className="mr-1.5 size-4" />
                  {a.label}
                </Button>
              ))}
            </div>
          )}
        </section>
      )}

      {equipment.notes && (
        <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold">Notes</h2>
          <p className="whitespace-pre-line text-sm text-muted-foreground">
            {equipment.notes}
          </p>
        </section>
      )}
    </div>
  );
}

function CadenceCard({
  label,
  cadenceMonths,
  lastAt,
  nextAt,
  prefs,
}: {
  label: string;
  cadenceMonths: number | null;
  lastAt: string | null;
  nextAt: string | null;
  prefs: CompanyDefaults;
}) {
  const overdue = nextAt
    ? new Date(nextAt).getTime() < Date.now()
    : false;

  return (
    <div className="rounded-lg border border-border/60 bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between text-muted-foreground">
        <span className="text-[10px] font-semibold uppercase tracking-wider">
          {label}
        </span>
        <Wrench className="size-3.5" />
      </div>
      <p className="mt-2 text-sm font-semibold">
        Every{" "}
        {cadenceMonths ? `${cadenceMonths} months` : "—"}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Last: {lastAt ? formatCompanyDate(lastAt, prefs) : "—"}
      </p>
      <p
        className={
          "text-xs " +
          (overdue ? "text-destructive font-medium" : "text-muted-foreground")
        }
      >
        Next: {nextAt ? formatCompanyDate(nextAt, prefs) : "—"}
        {overdue ? " (overdue)" : ""}
      </p>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card p-4 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  );
}
