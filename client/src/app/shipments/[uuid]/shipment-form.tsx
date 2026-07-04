"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Camera,
  CheckCircle2,
  Loader2,
  RefreshCw,
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

interface FormState {
  recipient_name: string;
  ship_to_address: string;
  ship_to_country: string;
  carrier: string;
  vehicle_registration: string;
  driver_name: string;
  consignment_note_ref: string;
  seal_number: string;
  temperature_c: string;
  planned_ship_at: string;
  notes: string;
  qty: string;
}

function initialFrom(s: Shipment): FormState {
  return {
    recipient_name: s.recipient_name ?? "",
    ship_to_address: s.ship_to_address ?? "",
    ship_to_country: s.ship_to_country ?? "",
    carrier: s.carrier ?? "",
    vehicle_registration: s.vehicle_registration ?? "",
    driver_name: s.driver_name ?? "",
    consignment_note_ref: s.consignment_note_ref ?? "",
    seal_number: s.seal_number ?? "",
    temperature_c: s.temperature_c ?? "",
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
    carrier: state.carrier || null,
    vehicle_registration: state.vehicle_registration || null,
    driver_name: state.driver_name || null,
    consignment_note_ref: state.consignment_note_ref || null,
    seal_number: state.seal_number || null,
    temperature_c: state.temperature_c || null,
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
  const [photoUrl, setPhotoUrl] = useState<string | null>(
    shipment.loading_photo_url,
  );
  const [photoUploading, setPhotoUploading] = useState(false);
  const [error, setError] = useState<ErrorResult | null>(null);
  const [saving, startSave] = useTransition();
  const [busy, startTransition] = useTransition();

  useFormPresenceBeacon(`shipment:${shipment.uuid}`);

  useEffect(() => {
    const fresh = initialFrom(shipment);
    setState(fresh);
    setOriginal(fresh);
    setPhotoUrl(shipment.loading_photo_url);
  }, [shipment]);

  const editable = shipment.status === "draft" || shipment.status === "ready";
  const finalized =
    shipment.status === "picked_up" || shipment.status === "cancelled";
  const dirty = JSON.stringify(state) !== JSON.stringify(original);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setState((prev) => ({ ...prev, [key]: value }));

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setError(null);
    setPhotoUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch("/api/stock/movement-photos", {
        method: "POST",
        body: fd,
      });
      const data = (await res.json()) as {
        photo_url?: string;
        detail?: string;
      };
      if (!res.ok || !data.photo_url) {
        setError({
          ok: false,
          code: "photo_upload_failed",
          detail: data.detail ?? "Photo upload failed.",
          debug: { source: "ShipmentForm.onPhoto" },
        } as ErrorResult);
        return;
      }
      // Persist the URL against the shipment straight away — no
      // separate Save click needed for evidence.
      const upd = await updateShipmentAction(shipment.uuid, {
        loading_photo_url: data.photo_url,
      });
      if (!upd.ok) {
        setError(upd);
        return;
      }
      setPhotoUrl(data.photo_url);
      toast.success("Loading photo saved.");
      router.refresh();
    } finally {
      setPhotoUploading(false);
      e.target.value = "";
    }
  }

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
    if (!confirm("Truck has arrived and taken the shipment?")) return;
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

      {/* -------- Recipient -------- */}
      <FieldsCard
        title="Recipient"
        subtitle="Who's receiving the goods."
        disabled={!editable}
      >
        <Field label="Recipient name" htmlFor="recipient_name">
          <Input
            id="recipient_name"
            value={state.recipient_name}
            onChange={(e) => setField("recipient_name", e.target.value)}
            disabled={!editable}
            placeholder="e.g. Acme Ltd receiving desk"
          />
        </Field>
        <Field
          label="Ship-to address"
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
      </FieldsCard>

      {/* -------- Carrier -------- */}
      <FieldsCard
        title="Carrier + vehicle"
        subtitle="Who's driving it, on what plate."
        disabled={!editable}
      >
        <Field label="Carrier / haulier" htmlFor="carrier">
          <Input
            id="carrier"
            value={state.carrier}
            onChange={(e) => setField("carrier", e.target.value)}
            disabled={!editable}
            placeholder="e.g. DPD, Palletways"
          />
        </Field>
        <Field label="Vehicle registration" htmlFor="vehicle_registration">
          <Input
            id="vehicle_registration"
            value={state.vehicle_registration}
            onChange={(e) => setField("vehicle_registration", e.target.value)}
            disabled={!editable}
            placeholder="e.g. AB12 CDE"
            className="font-mono uppercase"
          />
        </Field>
        <Field label="Driver name" htmlFor="driver_name">
          <Input
            id="driver_name"
            value={state.driver_name}
            onChange={(e) => setField("driver_name", e.target.value)}
            disabled={!editable}
          />
        </Field>
        <Field label="Consignment note / waybill" htmlFor="consignment_note_ref">
          <Input
            id="consignment_note_ref"
            value={state.consignment_note_ref}
            onChange={(e) => setField("consignment_note_ref", e.target.value)}
            disabled={!editable}
            placeholder="e.g. WB123456"
            className="font-mono"
          />
        </Field>
        <Field label="Seal number (if sealed)" htmlFor="seal_number">
          <Input
            id="seal_number"
            value={state.seal_number}
            onChange={(e) => setField("seal_number", e.target.value)}
            disabled={!editable}
            placeholder="Optional"
            className="font-mono"
          />
        </Field>
        <Field label="Trailer temp °C (if chilled)" htmlFor="temperature_c">
          <Input
            id="temperature_c"
            type="number"
            step="0.1"
            value={state.temperature_c}
            onChange={(e) => setField("temperature_c", e.target.value)}
            disabled={!editable}
            placeholder="Optional"
          />
        </Field>
      </FieldsCard>

      {/* -------- Load -------- */}
      <FieldsCard
        title="Load"
        subtitle="Qty leaving + when the truck is booked."
        disabled={!editable}
      >
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
        <Field label="Planned ship time" htmlFor="planned_ship_at">
          <Input
            id="planned_ship_at"
            type="datetime-local"
            value={state.planned_ship_at}
            onChange={(e) => setField("planned_ship_at", e.target.value)}
            disabled={!editable}
          />
        </Field>
        <Field label="Notes" htmlFor="notes" className="sm:col-span-2">
          <Textarea
            id="notes"
            value={state.notes}
            onChange={(e) => setField("notes", e.target.value)}
            disabled={!editable}
            rows={3}
            placeholder="Anything unusual — split pallets, dietary flags, etc."
          />
        </Field>
      </FieldsCard>

      {/* -------- Loading photo -------- */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Camera className="size-4" />
            Loading photo
          </CardTitle>
        </CardHeader>
        <CardContent>
          {photoUrl ? (
            <div className="space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photoUrl}
                alt="Loading evidence"
                className="max-h-64 rounded-md border border-border/60"
              />
              {editable && (
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border/60 bg-background px-2 py-1 text-xs hover:bg-muted">
                  {photoUploading ? (
                    <>
                      <RefreshCw className="size-3.5 animate-spin" />
                      Uploading…
                    </>
                  ) : (
                    <>
                      <Camera className="size-3.5" />
                      Replace photo
                    </>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => void onPhoto(e)}
                  />
                </label>
              )}
            </div>
          ) : (
            <label className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border/60 p-6 text-sm active:bg-muted">
              {photoUploading ? (
                <>
                  <RefreshCw className="size-4 animate-spin" />
                  Uploading…
                </>
              ) : (
                <>
                  <Camera className="size-4" />
                  Attach loading photo
                </>
              )}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => void onPhoto(e)}
                disabled={!editable}
              />
            </label>
          )}
        </CardContent>
      </Card>

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
                    : "Flip to Ready once every mandatory field is filled."
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
      body: "Fill in recipient, carrier, vehicle, driver, waybill. Mark ready once everything's captured.",
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
  disabled,
  children,
}: {
  title: string;
  subtitle: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card className={cn(disabled && "opacity-90")}>
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
