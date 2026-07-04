"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CheckCircle2,
  Loader2,
  ShieldAlert,
  Truck,
  XCircle,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ErrorBanner } from "@/components/forms/error-banner";
import { useFormPresenceBeacon } from "@/lib/realtime/use-form-presence-beacon";
import { formatCompanyDate } from "@/lib/format/company";
import { cn } from "@/lib/utils";
import {
  cancelShipmentAction,
  confirmShipmentPickupAction,
  markShipmentDraftAction,
  markShipmentReadyAction,
  updateShipmentAction,
} from "@/lib/shipments/actions";
import type { ErrorResult } from "@/lib/errors/server";
import type {
  Shipment,
  ShipmentEditableFields,
} from "@/lib/shipments/types";
import type { CompanyDefaults } from "@/lib/types";

interface Props {
  shipment: Shipment;
  companyDefaults: CompanyDefaults | null;
}

/**
 * Only pre-truck fields. Everything you learn AT PICKUP (vehicle
 * registration, driver, waybill, seal, temperature, loading photo)
 * lives in the truck-arrival mobile flow — spec pending.
 */
interface FormState {
  recipient_name: string;
  ship_to_address: string;
  ship_to_country: string;
  planned_ship_at: string;
  notes: string;
  qty: string;
}

function initialFrom(s: Shipment): FormState {
  return {
    recipient_name: s.recipient_name ?? "",
    ship_to_address: s.ship_to_address ?? "",
    ship_to_country: s.ship_to_country ?? "",
    planned_ship_at: s.planned_ship_at ? s.planned_ship_at.slice(0, 16) : "",
    notes: s.notes ?? "",
    qty: s.qty ?? "",
  };
}

function toEditable(state: FormState): ShipmentEditableFields {
  return {
    recipient_name: state.recipient_name || null,
    ship_to_address: state.ship_to_address || null,
    ship_to_country: state.ship_to_country
      ? state.ship_to_country.toUpperCase()
      : null,
    planned_ship_at: state.planned_ship_at
      ? new Date(state.planned_ship_at).toISOString()
      : null,
    notes: state.notes || null,
    qty: state.qty,
  };
}

export function ShipmentForm({ shipment, companyDefaults }: Props) {
  const router = useRouter();
  const [state, setState] = useState<FormState>(() => initialFrom(shipment));
  const [original, setOriginal] = useState<FormState>(() =>
    initialFrom(shipment),
  );
  const [error, setError] = useState<ErrorResult | null>(null);
  const [saving, startSave] = useTransition();
  const [busy, startTransition] = useTransition();

  useFormPresenceBeacon(`shipment:${shipment.uuid}`);

  useEffect(() => {
    const fresh = initialFrom(shipment);
    setState(fresh);
    setOriginal(fresh);
  }, [shipment]);

  const editable = shipment.status === "draft" || shipment.status === "ready";
  const finalized =
    shipment.status === "picked_up" || shipment.status === "cancelled";
  const dirty = JSON.stringify(state) !== JSON.stringify(original);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setState((prev) => ({ ...prev, [key]: value }));

  const save = () => {
    setError(null);
    startSave(async () => {
      const res = await updateShipmentAction(shipment.uuid, toEditable(state));
      if (!res.ok) {
        setError(res);
        return;
      }
      setOriginal(state);
      toast.success("Shipment saved.");
      router.refresh();
    });
  };

  const markReady = () => {
    startTransition(async () => {
      const res = await markShipmentReadyAction(shipment.uuid);
      if (!res.ok) {
        setError(res);
        return;
      }
      toast.success("Ready for pickup.");
      router.refresh();
    });
  };

  const markDraft = () => {
    startTransition(async () => {
      const res = await markShipmentDraftAction(shipment.uuid);
      if (!res.ok) {
        setError(res);
        return;
      }
      toast.info("Reopened for edits.");
      router.refresh();
    });
  };

  const confirmPickup = () => {
    if (
      !confirm(
        "Truck has arrived and taken the shipment? The full truck-arrival form isn't built yet — this just marks the goods as picked up for now.",
      )
    )
      return;
    startTransition(async () => {
      const res = await confirmShipmentPickupAction(shipment.uuid);
      if (!res.ok) {
        setError(res);
        return;
      }
      toast.success("Pickup confirmed.");
      router.refresh();
    });
  };

  const cancelShipment = () => {
    const reason = prompt("Why are you cancelling this shipment?");
    if (!reason || !reason.trim()) return;
    startTransition(async () => {
      const res = await cancelShipmentAction(shipment.uuid, reason.trim());
      if (!res.ok) {
        setError(res);
        return;
      }
      toast.success("Shipment cancelled.");
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <StatusBanner shipment={shipment} companyDefaults={companyDefaults} />

      {error && <ErrorBanner detail={error.detail} code={error.code} />}

      {/* -------- Lot summary -------- */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Goods on this shipment</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <DetailRow label="Item" value={shipment.stock_lot?.item?.name ?? "—"} />
          <DetailRow
            label="Lot code"
            value={
              <span className="font-mono">
                {shipment.stock_lot?.code ?? "—"}
              </span>
            }
          />
          <DetailRow
            label="Supplier batch"
            value={shipment.stock_lot?.supplier_batch_no ?? "—"}
            mono
          />
          <DetailRow
            label="Expires"
            value={formatCompanyDate(
              shipment.stock_lot?.expiry_at,
              companyDefaults,
            )}
          />
          <DetailRow
            label="Currently in"
            value={placementLabel(shipment.stock_lot?.placement)}
          />
          <DetailRow
            label="Custody"
            value={
              shipment.stock_lot?.ownership_kind === "bailee"
                ? `Bailee (held for ${
                    shipment.stock_lot?.bailee_customer?.name ?? "customer"
                  })`
                : "Own stock"
            }
          />
        </CardContent>
      </Card>

      {/* -------- Delivery -------- */}
      <FieldsCard
        title="Delivery"
        subtitle="What we can fill in before the truck arrives — recipient + address + timing."
      >
        <Field label="Delivery to (recipient)" htmlFor="recipient_name">
          <Input
            id="recipient_name"
            value={state.recipient_name}
            onChange={(e) => setField("recipient_name", e.target.value)}
            disabled={!editable}
            placeholder="e.g. Acme Ltd receiving desk"
          />
        </Field>
        <Field label="Country (ISO)" htmlFor="ship_to_country">
          <Input
            id="ship_to_country"
            value={state.ship_to_country}
            onChange={(e) =>
              setField(
                "ship_to_country",
                e.target.value.slice(0, 2).toUpperCase(),
              )
            }
            disabled={!editable}
            placeholder="GB"
            className="font-mono uppercase"
            maxLength={2}
          />
        </Field>
        <Field
          label="Delivery address"
          htmlFor="ship_to_address"
          className="sm:col-span-2"
        >
          <Textarea
            id="ship_to_address"
            value={state.ship_to_address}
            onChange={(e) => setField("ship_to_address", e.target.value)}
            disabled={!editable}
            rows={3}
            placeholder="Street, city, postcode"
          />
        </Field>
        <Field label="Planned ship time" htmlFor="planned_ship_at">
          <Input
            id="planned_ship_at"
            type="datetime-local"
            value={state.planned_ship_at}
            onChange={(e) => setField("planned_ship_at", e.target.value)}
            disabled={!editable}
          />
        </Field>
        <Field label="Qty" htmlFor="qty">
          <Input
            id="qty"
            type="number"
            step="0.0001"
            value={state.qty}
            onChange={(e) => setField("qty", e.target.value)}
            disabled={!editable}
          />
        </Field>
        <Field label="Notes" htmlFor="notes" className="sm:col-span-2">
          <Textarea
            id="notes"
            value={state.notes}
            onChange={(e) => setField("notes", e.target.value)}
            disabled={!editable}
            rows={2}
            placeholder="Anything the truck arrival team should know."
          />
        </Field>
      </FieldsCard>

      {/* -------- Truck-arrival read-only strip -------- */}
      {shipment.status === "picked_up" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Truck className="size-4" />
              Truck arrival record
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Filled in from the mobile truck-arrival flow (once we build it).
              Empty rows just mean the current pickup was confirmed via the
              placeholder button.
            </p>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
            <DetailRow
              label="Carrier"
              value={shipment.carrier ?? "—"}
            />
            <DetailRow
              label="Vehicle registration"
              value={shipment.vehicle_registration ?? "—"}
              mono
            />
            <DetailRow
              label="Driver"
              value={shipment.driver_name ?? "—"}
            />
            <DetailRow
              label="Waybill / consignment"
              value={shipment.consignment_note_ref ?? "—"}
              mono
            />
            <DetailRow
              label="Seal number"
              value={shipment.seal_number ?? "—"}
              mono
            />
            <DetailRow
              label="Trailer temperature"
              value={
                shipment.temperature_c ? `${shipment.temperature_c} °C` : "—"
              }
            />
          </CardContent>
        </Card>
      )}

      {/* -------- Actions -------- */}
      {!finalized && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2 py-4">
            {editable && (
              <Button disabled={!dirty || saving} onClick={save}>
                {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
                Save changes
              </Button>
            )}
            {shipment.status === "draft" && (
              <Button
                variant="outline"
                onClick={markReady}
                disabled={busy || dirty}
                title={
                  dirty
                    ? "Save your edits first."
                    : "Flip to Ready once recipient + delivery address + country are filled."
                }
              >
                <CheckCircle2 className="mr-1 size-4" />
                Mark ready for pickup
              </Button>
            )}
            {shipment.status === "ready" && (
              <>
                <Button variant="outline" onClick={markDraft} disabled={busy}>
                  Reopen for edits
                </Button>
                <Button onClick={confirmPickup} disabled={busy}>
                  <Truck className="mr-1 size-4" />
                  Truck arrived — confirm pickup
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              onClick={cancelShipment}
              disabled={busy}
              className="ml-auto text-destructive hover:text-destructive"
            >
              <XCircle className="mr-1 size-4" />
              Cancel shipment
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ================================================================
// Sub-components
// ================================================================

function StatusBanner({
  shipment,
  companyDefaults,
}: {
  shipment: Shipment;
  companyDefaults: CompanyDefaults | null;
}) {
  const cfg = {
    draft: {
      Icon: ShieldAlert,
      cls: "border-border/60 bg-muted/40",
      title: "Draft — paperwork in progress",
      body: "Fill in recipient + delivery address + country. Mark ready once those three are captured; the truck-arrival flow (vehicle reg, driver, waybill, seal, photo) is a follow-up.",
    },
    ready: {
      Icon: CheckCircle2,
      cls: "border-sky-500/40 bg-sky-500/5",
      title: "Ready for pickup",
      body: `Marked ready ${
        shipment.ready_at
          ? formatCompanyDate(shipment.ready_at, companyDefaults)
          : ""
      } by ${shipment.ready_by?.name ?? "—"}. Waiting for the truck.`,
    },
    picked_up: {
      Icon: Truck,
      cls: "border-emerald-500/40 bg-emerald-500/5",
      title: "Picked up",
      body: `Left the warehouse ${
        shipment.picked_up_at
          ? formatCompanyDate(shipment.picked_up_at, companyDefaults)
          : ""
      } via ${shipment.picked_up_by?.name ?? "—"}. Record is now immutable.`,
    },
    cancelled: {
      Icon: XCircle,
      cls: "border-destructive/40 bg-destructive/5",
      title: "Cancelled",
      body: `Cancelled by ${shipment.cancelled_by?.name ?? "—"}${
        shipment.cancel_reason ? ` — ${shipment.cancel_reason}` : ""
      }.`,
    },
  }[shipment.status];

  const { Icon } = cfg;
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
        cfg.cls,
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div>
        <p className="font-semibold">{cfg.title}</p>
        <p className="text-xs text-muted-foreground">{cfg.body}</p>
      </div>
    </div>
  );
}

function FieldsCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">{title}</CardTitle>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">{children}</CardContent>
    </Card>
  );
}

function Field({
  label,
  htmlFor,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor} className="text-xs">
        {label}
      </Label>
      {children}
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[minmax(120px,1fr)_2fr] items-baseline gap-2">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className={cn("text-sm", mono && "font-mono text-xs")}>
        {value}
      </span>
    </div>
  );
}

function placementLabel(
  p:
    | {
        cell_name: string | null;
        cell_code: string | null;
        cell_purpose: string;
        location_name: string | null;
        location_code: string | null;
      }
    | null
    | undefined,
): string {
  if (!p) return "—";
  const loc = p.location_name?.trim() || p.location_code?.trim() || "—";
  const cell = p.cell_name?.trim() || p.cell_code?.trim() || "—";
  return `${loc} · ${cell} · ${p.cell_purpose}`;
}
