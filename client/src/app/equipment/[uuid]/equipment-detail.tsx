"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowRight,
  CheckCircle2,
  Loader2,
  MapPin,
  Move,
  Printer,
  PowerOff,
  RotateCcw,
  Trash2,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge-mini";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ErrorBanner } from "@/components/forms/error-banner";
import { recordEquipmentEventAction } from "@/lib/equipment/actions";
import type { Equipment, EquipmentStatus } from "@/lib/equipment/types";
import { PrintEquipmentLabelDialog } from "./print-label-dialog";
import { MoveEquipmentDialog } from "./move-equipment-dialog";
import { formatCompanyDate } from "@/lib/format/company";
import type { CompanyDefaults } from "@/lib/types";
import type { ErrorDebug } from "@/lib/errors/types";

const STATUS_LABEL: Record<EquipmentStatus, string> = {
  expected: "Expected",
  received: "Received",
  in_service: "In service",
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
  retired: "muted",
  disposed: "muted",
  canceled: "muted",
};

// Which lifecycle actions are available from the current status.
// ERPNext-style: status only tracks physical presence, so the only
// actions are "advance to next lifecycle state". Maintenance /
// calibration / repair actions live on the dedicated cards below,
// keyed off the schedule / breakdown record — never off status.
//
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
    { kind: "retired", label: "Retire", icon: PowerOff },
  ],
  in_service: [
    // Withdraw the unit back to the pool (e.g. reassigning to
    // another station, taking it offline temporarily). Not the
    // same as retiring — the unit is still fit for service.
    { kind: "received", label: "Return to pool", icon: Undo2 },
    { kind: "retired", label: "Retire", icon: PowerOff },
  ],
  retired: [
    // Escape hatch — someone retired a unit by mistake. Un-retire
    // brings it back to in-service; retired_at is cleared.
    { kind: "in_service", label: "Un-retire", icon: RotateCcw },
    { kind: "disposed", label: "Dispose", icon: Trash2 },
  ],
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
  const [labelOpen, setLabelOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);

  // Compose the "where is it" line — priority: assigned user > cell
  // > free-text description > "—". Only one shows so the operator
  // gets a single authoritative source per row.
  const locationLine = equipment.assigned_to
    ? `Assigned to ${equipment.assigned_to.name}`
    : equipment.current_cell
      ? `${equipment.current_cell.name}${equipment.current_cell.warehouse?.name ? ` · ${equipment.current_cell.warehouse.name}` : ""}`
      : equipment.location_description
        ? equipment.location_description
        : "—";

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
      <Card className="border-border/60">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1.5">
              <CardTitle className="flex items-center gap-2">
                <Badge tone={STATUS_TONE[equipment.status]}>
                  {STATUS_LABEL[equipment.status]}
                </Badge>
                {equipment.assigned_to && (
                  <span className="text-xs font-normal text-muted-foreground">
                    Assigned to {equipment.assigned_to.name}
                  </span>
                )}
              </CardTitle>
              <CardDescription>
                {equipment.manufacturer ?? "—"} · {equipment.model ?? "—"}
                {equipment.manufacturer_serial
                  ? ` · OEM ${equipment.manufacturer_serial}`
                  : ""}
              </CardDescription>
            </div>
            <div className="flex flex-col items-end gap-2 text-xs">
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Location
                </p>
                <p className="inline-flex items-center gap-1 font-medium">
                  <MapPin className="size-3 text-muted-foreground" />
                  {locationLine}
                </p>
                {equipment.current_cell?.warehouse?.uuid && (
                  <Link
                    href={`/settings/warehouses/${equipment.current_cell.warehouse.uuid}`}
                    className="mt-0.5 inline-block text-[10px] text-muted-foreground underline-offset-2 hover:underline"
                  >
                    Open plan →
                  </Link>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {canAct && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setMoveOpen(true)}
                    disabled={pending}
                  >
                    <Move className="mr-1 size-3.5" />
                    Move
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setLabelOpen(true)}
                >
                  <Printer className="mr-1 size-3.5" />
                  Print label
                </Button>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
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
        </CardContent>
      </Card>

      {/* Actions */}
      {canAct && actions.length > 0 && (
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle>Actions</CardTitle>
            <CardDescription>
              Move this unit through its lifecycle. Maintenance and
              repair actions live on the cards below — they don't
              change the status here.
            </CardDescription>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
      )}

      {equipment.notes && (
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-line text-sm text-muted-foreground">
              {equipment.notes}
            </p>
          </CardContent>
        </Card>
      )}

      <PrintEquipmentLabelDialog
        equipment={labelOpen ? equipment : null}
        open={labelOpen}
        onOpenChange={setLabelOpen}
      />

      <MoveEquipmentDialog
        equipment={moveOpen ? equipment : null}
        open={moveOpen}
        onOpenChange={setMoveOpen}
      />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  );
}
