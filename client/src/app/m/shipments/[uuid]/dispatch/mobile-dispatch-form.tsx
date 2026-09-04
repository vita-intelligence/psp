"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  Check,
  CheckCircle2,
  Clock,
  ImageIcon,
  Loader2,
  MailCheck,
  Package,
  Trash2,
  Truck,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { formatCompanyDate } from "@/lib/format/company";
import { logShipmentPickupEventAction } from "@/lib/shipments/actions";
import type {
  Shipment,
  ShipmentPickupChecklist,
  ShipmentPickupEvent,
  ShipmentPickupFile,
} from "@/lib/shipments/types";
import type { CompanyDefaults } from "@/lib/types";

interface Props {
  shipment: Shipment;
  prefs: CompanyDefaults | null;
}

type ChecklistKey = Exclude<
  keyof ShipmentPickupChecklist,
  "carrier" | "vehicle_registration" | "driver_name" | "consignment_note_ref"
>;

interface ChecklistItem {
  key: ChecklistKey;
  label: string;
  hint: string;
}

const CHECKLIST: ChecklistItem[] = [
  {
    key: "packaging_intact",
    label: "Packaging intact",
    hint: "No tears, crushes, dents, or open seals on the outer cases.",
  },
  {
    key: "labels_verified",
    label: "Correct labels verified",
    hint: "Lot / product / batch labels match the shipment on every pallet.",
  },
  {
    key: "vehicle_clean_suitable",
    label: "Vehicle clean & suitable",
    hint: "No debris, off-odour, pests, or residues from the previous load.",
  },
  {
    key: "transport_condition_acceptable",
    label: "Transport condition acceptable",
    hint: "Temperature, humidity, and securing straps all inside the spec.",
  },
  {
    key: "dispatch_approved",
    label: "Dispatch approved",
    hint: "Final sign-off — I authorise this consignment to leave the site.",
  },
];

/**
 * Entry point rendered by the page. The dispatch flow is closed once
 * the shipment has been fully picked up — no more trucks are coming
 * and the next action lives with the customer (delivery confirmation
 * on their portal). Render a read-only summary of what happened
 * instead of the "log a new pickup event" form; the form was showing
 * up on the Confirm tab and misleading operators into filling it in
 * a second time. Split into two components so each keeps a stable
 * hook order (React rules-of-hooks).
 */
export function MobileDispatchForm(props: Props) {
  const { shipment } = props;
  if (shipment.status === "picked_up" || shipment.status === "delivered") {
    return <DispatchSummary shipment={shipment} prefs={props.prefs} />;
  }
  return <MobileDispatchFormInner {...props} />;
}

function MobileDispatchFormInner({ shipment }: Props) {
  const router = useRouter();
  // Each truck visit is a fresh check — a new driver, a new vehicle, a
  // new load with its own condition. Anything denormalised onto the
  // shipment from a previous event (carrier, driver, reg, checklist)
  // is history, not a default. We prefill nothing so the operator has
  // to look at THIS truck.
  const pickedUpQtyNum = Number(shipment.picked_up_qty ?? 0);
  const isSubsequentVisit = Number.isFinite(pickedUpQtyNum) && pickedUpQtyNum > 0;
  const [carrier, setCarrier] = useState(
    isSubsequentVisit ? "" : shipment.carrier ?? "",
  );
  const [vehicleReg, setVehicleReg] = useState(
    isSubsequentVisit ? "" : shipment.vehicle_registration ?? "",
  );
  const [driverName, setDriverName] = useState(
    isSubsequentVisit ? "" : shipment.driver_name ?? "",
  );
  const [consignmentNote, setConsignmentNote] = useState(
    isSubsequentVisit ? "" : shipment.consignment_note_ref ?? "",
  );
  // Per-truck paperwork the customer sees on the portal. Tracking
  // number is often unknown at pickup (carrier emails it later) —
  // it's fine to leave blank on mobile; the operator can amend on
  // desktop via the pickup-event paperwork PATCH.
  const [trackingNumber, setTrackingNumber] = useState("");
  const [sealNumber, setSealNumber] = useState("");
  const [temperatureC, setTemperatureC] = useState("");
  // Multi-visit pickups. Default this-visit qty to whatever's still
  // owed on the shipment (single-visit pickups match ``shipment.qty``
  // exactly). Operator can lower it if the truck is only taking a
  // partial load.
  const remainingQty = Number(shipment.remaining_qty ?? shipment.qty ?? 0);
  const [visitQty, setVisitQty] = useState<string>(String(remainingQty));
  // Hide the "Qty on THIS truck" input when the shipment can only
  // ride on one truck — nothing to split, so asking the operator
  // to confirm "1 out of 1" is noise. The visitQty state still
  // carries remainingQty into the payload; the operator just
  // doesn't see or edit the field.
  const isSingleTruckable = remainingQty <= 1;
  const [checks, setChecks] = useState<Record<ChecklistKey, boolean>>(
    isSubsequentVisit
      ? {
          packaging_intact: false,
          labels_verified: false,
          vehicle_clean_suitable: false,
          transport_condition_acceptable: false,
          dispatch_approved: false,
        }
      : {
          packaging_intact: shipment.packaging_intact === true,
          labels_verified: shipment.labels_verified === true,
          vehicle_clean_suitable: shipment.vehicle_clean_suitable === true,
          transport_condition_acceptable:
            shipment.transport_condition_acceptable === true,
          dispatch_approved: shipment.dispatch_approved === true,
        },
  );
  // Only free-floating pickup files (not linked to a prior event) are
  // fair game as this-visit evidence. On a fresh mount for a subsequent
  // visit, previously-linked photos never come back down from the
  // server, so this is really just belt + braces.
  const [files, setFiles] = useState<ShipmentPickupFile[]>(
    isSubsequentVisit ? [] : shipment.pickup_files ?? [],
  );
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const toggle = useCallback(
    (key: ChecklistKey, value: boolean) => {
      setChecks((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  async function uploadOne(file: File): Promise<ShipmentPickupFile> {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(
      `/api/shipments/${encodeURIComponent(shipment.uuid)}/pickup-files`,
      { method: "POST", body: fd },
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        detail?: string;
        error?: string;
      };
      throw new Error(body.detail || body.error || `HTTP ${res.status}`);
    }
    const body = (await res.json()) as { file: ShipmentPickupFile };
    return body.file;
  }

  async function onFilesPicked(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setUploadError(null);
    setUploading(true);
    try {
      for (const file of Array.from(fileList)) {
        const uploaded = await uploadOne(file);
        setFiles((prev) => [...prev, uploaded]);
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function deleteFile(fileUuid: string) {
    const snapshot = files;
    setFiles((prev) => prev.filter((f) => f.uuid !== fileUuid));
    const res = await fetch(
      `/api/shipments/${encodeURIComponent(shipment.uuid)}/pickup-files/${encodeURIComponent(fileUuid)}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      setFiles(snapshot);
      toast.error("Couldn't remove the photo.");
    }
  }

  const visitQtyNum = Number(visitQty);
  const visitQtyEmpty = visitQty.trim() === "";
  const visitQtyInvalid =
    !visitQtyEmpty && (!Number.isFinite(visitQtyNum) || visitQtyNum <= 0);
  const visitQtyOverCap =
    !visitQtyEmpty &&
    Number.isFinite(visitQtyNum) &&
    visitQtyNum > remainingQty;
  const missing: string[] = [];
  if (!vehicleReg.trim()) missing.push("Vehicle registration");
  if (visitQtyEmpty) missing.push("Qty on this truck");
  else if (visitQtyInvalid) missing.push("Qty on this truck (must be > 0)");
  else if (visitQtyOverCap)
    missing.push(`Qty on this truck (max ${remainingQty})`);
  for (const item of CHECKLIST) {
    if (!checks[item.key]) missing.push(item.label);
  }
  if (files.length === 0) missing.push("At least one photo of the load");

  const canSubmit = missing.length === 0 && !pending && !uploading;

  function onSubmit() {
    setSubmitError(null);
    startTransition(async () => {
      // Log one pickup event with the qty picked up on THIS truck.
      // Files uploaded during the form's lifecycle land free-floating
      // on the shipment; we pass their uuids so the BE atomically
      // links them to the fresh event.
      const res = await logShipmentPickupEventAction(shipment.uuid, {
        qty: visitQty.trim(),
        carrier: carrier.trim() || null,
        driver_name: driverName.trim() || null,
        vehicle_registration: vehicleReg.trim() || null,
        consignment_note_ref: consignmentNote.trim() || null,
        tracking_number: trackingNumber.trim() || null,
        seal_number: sealNumber.trim() || null,
        temperature_c: temperatureC.trim() || null,
        packaging_intact: checks.packaging_intact,
        labels_verified: checks.labels_verified,
        vehicle_clean_suitable: checks.vehicle_clean_suitable,
        transport_condition_acceptable: checks.transport_condition_acceptable,
        dispatch_approved: checks.dispatch_approved,
        pickup_file_ids: files.map((f) => f.uuid),
      });
      if (!res.ok) {
        setSubmitError(res.detail);
        return;
      }
      toast.success(
        visitQtyNum < remainingQty
          ? "Partial pickup logged."
          : "Dispatch confirmed.",
      );
      router.push("/m");
    });
  }

  const lotCode = shipment.stock_lot?.code ?? null;
  const itemName = shipment.stock_lot?.item?.name ?? null;
  const customer = shipment.customer?.name ?? null;

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="sticky top-0 z-10 border-b border-border/60 bg-background/95 backdrop-blur">
        <div className="flex items-center gap-2 px-3 py-2">
          <Button
            variant="ghost"
            size="icon"
            className="size-9"
            onClick={() => router.push("/m")}
            aria-label="Back"
          >
            <ArrowLeft className="size-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <p className="truncate text-sm font-semibold">Truck arrived</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {itemName ?? lotCode ?? "Dispatch checklist"}
              {customer ? ` · ${customer}` : ""}
            </p>
          </div>
          <Truck className="size-5 text-brand" />
        </div>
      </header>

      <main className="flex-1 space-y-5 px-4 py-4 pb-32">
        {/* This-visit qty. Prominent because it's the load-bearing
            decision for multi-visit pickups. Defaults to the whole
            remaining qty so single-visit trucks just tap through.
            Hidden entirely when the shipment can only ride on one
            truck (remainingQty <= 1) — visitQty state still
            carries remainingQty into the submit payload. */}
        {isSingleTruckable ? (
          <section className="rounded-xl border border-brand/40 bg-brand/5 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-brand">
              Whole shipment on this truck
            </p>
            <p className="mt-1 font-mono text-2xl font-semibold">
              {remainingQty} {shipment.stock_lot?.unit_symbol ?? ""}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Nothing to split — this shipment fits on one visit.
            </p>
          </section>
        ) : (
          <section className="rounded-xl border border-brand/40 bg-brand/5 p-4">
            <Label htmlFor="visit-qty" className="text-xs font-semibold uppercase tracking-wider">
              Qty on THIS truck
            </Label>
            <Input
              id="visit-qty"
              type="number"
              min={1}
              max={remainingQty}
              step="any"
              value={visitQty}
              onChange={(e) => setVisitQty(e.target.value)}
              aria-invalid={visitQtyInvalid || visitQtyOverCap}
              className={cn(
                "mt-1 h-14 text-2xl font-mono font-semibold text-center",
                (visitQtyInvalid || visitQtyOverCap) &&
                  "border-destructive focus-visible:ring-destructive",
              )}
            />
            {visitQtyOverCap ? (
              <div
                role="alert"
                aria-live="polite"
                className="mt-2 flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/[0.06] px-2.5 py-2 text-xs font-medium text-destructive"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <p>
                  Too much for this truck — only{" "}
                  <span className="font-mono font-semibold">{remainingQty}</span>{" "}
                  units are still owed on this shipment. Lower the quantity
                  to continue.
                </p>
              </div>
            ) : visitQtyInvalid ? (
              <div
                role="alert"
                aria-live="polite"
                className="mt-2 flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/[0.06] px-2.5 py-2 text-xs font-medium text-destructive"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <p>Enter a positive quantity.</p>
              </div>
            ) : (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Remaining on this shipment:{" "}
                <span className="font-mono font-semibold">{remainingQty}</span>.
                Reduce this number if the truck is only taking part of the
                load; the rest stays in the dispatch cell for the next visit.
              </p>
            )}
          </section>
        )}

        <section className="grid grid-cols-1 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="carrier">
              Delivery company{" "}
              <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input
              id="carrier"
              value={carrier}
              onChange={(e) => setCarrier(e.target.value)}
              placeholder="e.g. DHL, own fleet…"
              autoComplete="off"
              className="h-12 text-base"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vreg">Vehicle registration</Label>
            <Input
              id="vreg"
              value={vehicleReg}
              onChange={(e) => setVehicleReg(e.target.value.toUpperCase())}
              placeholder="AB12 CDE"
              autoComplete="off"
              className="h-12 text-base font-mono uppercase tracking-wider"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="driver">
              Driver{" "}
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
            </Label>
            <Input
              id="driver"
              value={driverName}
              onChange={(e) => setDriverName(e.target.value)}
              placeholder="Name off the driver's badge"
              autoComplete="off"
              className="h-12 text-base"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cn">
              Consignment note / waybill{" "}
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
            </Label>
            <Input
              id="cn"
              value={consignmentNote}
              onChange={(e) => setConsignmentNote(e.target.value)}
              placeholder="e.g. CN-92814"
              autoComplete="off"
              className="h-12 text-base font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tracking">
              Tracking number{" "}
              <span className="text-muted-foreground font-normal">
                (optional — carriers often email it later)
              </span>
            </Label>
            <Input
              id="tracking"
              value={trackingNumber}
              onChange={(e) => setTrackingNumber(e.target.value)}
              placeholder="e.g. DHL-9F92-4402"
              autoComplete="off"
              className="h-12 text-base font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="seal">
              Seal number{" "}
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
            </Label>
            <Input
              id="seal"
              value={sealNumber}
              onChange={(e) => setSealNumber(e.target.value)}
              placeholder="e.g. SL-00214"
              autoComplete="off"
              className="h-12 text-base font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="temp">
              Temperature (°C){" "}
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
            </Label>
            <Input
              id="temp"
              type="number"
              step="0.1"
              min={-60}
              max={60}
              value={temperatureC}
              onChange={(e) => setTemperatureC(e.target.value)}
              placeholder="e.g. 4"
              autoComplete="off"
              className="h-12 text-base font-mono"
            />
          </div>
        </section>

        <section className="space-y-2">
          <Label>Checklist</Label>
          <p className="text-xs text-muted-foreground">
            Every box must be ticked to confirm dispatch.
          </p>
          <ul className="space-y-2">
            {CHECKLIST.map((item) => (
              <li
                key={item.key}
                className={cn(
                  "flex items-start gap-3 rounded-md border p-3 transition-colors",
                  checks[item.key]
                    ? "border-emerald-500/40 bg-emerald-500/[0.04]"
                    : "border-border/60 bg-background",
                )}
              >
                <Checkbox
                  id={`chk-${item.key}`}
                  checked={checks[item.key]}
                  onCheckedChange={(v) => toggle(item.key, v === true)}
                  className="mt-0.5 size-6"
                />
                <label
                  htmlFor={`chk-${item.key}`}
                  className="cursor-pointer select-none"
                >
                  <p className="text-sm font-medium">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.hint}</p>
                </label>
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label>Photos of the load</Label>
            <span className="text-xs text-muted-foreground">
              {files.length} attached
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            At least one photo required. Camera opens directly on tap.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="sr-only"
            onChange={(e) => onFilesPicked(e.target.files)}
          />
          <Button
            type="button"
            variant="outline"
            className="w-full h-14 text-base"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <>
                <Loader2 className="mr-2 size-5 animate-spin" />
                Uploading…
              </>
            ) : (
              <>
                <Camera className="mr-2 size-5" />
                Take a photo
              </>
            )}
          </Button>
          {uploadError && (
            <p className="text-xs text-destructive">{uploadError}</p>
          )}
          {files.length > 0 && (
            <ul className="grid grid-cols-3 gap-2 pt-1">
              {files.map((f) => (
                <li
                  key={f.uuid}
                  className="group relative overflow-hidden rounded-md border border-border/60 bg-muted/20"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={f.url}
                    alt={f.filename}
                    className="aspect-square w-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => deleteFile(f.uuid)}
                    className="absolute right-1 top-1 rounded-full bg-background/90 p-1.5 text-destructive shadow ring-1 ring-border"
                    aria-label="Remove photo"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {submitError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/[0.03] p-3 text-sm text-destructive">
            {submitError}
          </div>
        )}
      </main>

      <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-border/60 bg-background/95 p-3 backdrop-blur">
        <Button
          type="button"
          size="lg"
          onClick={onSubmit}
          disabled={!canSubmit}
          className="h-14 w-full text-base"
        >
          {pending && <Loader2 className="mr-2 size-5 animate-spin" />}
          <CheckCircle2 className="mr-2 size-5" />
          Confirm dispatch
        </Button>
        {missing.length > 0 && (
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            Still missing: {missing.join(", ")}
          </p>
        )}
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------
// Read-only summary — rendered from the Confirm tab (envelope) when
// the shipment is already fully picked up. Shows every field the
// operator captured during the pickup flow (per-visit) so a phone
// tap on the row goes to "what already happened" instead of "log a
// new event." Delivery confirmation still lives with the customer.
// ---------------------------------------------------------------

function DispatchSummary({
  shipment,
  prefs,
}: {
  shipment: Shipment;
  prefs: CompanyDefaults | null;
}) {
  const router = useRouter();
  const itemName = shipment.stock_lot?.item?.name ?? null;
  const lotCode = shipment.stock_lot?.code ?? null;
  const customer = shipment.customer?.name ?? null;
  const unit = shipment.stock_lot?.unit_symbol ?? "";
  const isDelivered = shipment.status === "delivered";
  const events = [...(shipment.pickup_events ?? [])].sort((a, b) =>
    a.picked_up_at < b.picked_up_at ? -1 : 1,
  );

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="sticky top-0 z-10 border-b border-border/60 bg-background/95 backdrop-blur">
        <div className="flex items-center gap-2 px-3 py-2">
          <Button
            variant="ghost"
            size="icon"
            className="size-9"
            onClick={() => router.push("/m/three-pl-dispatches?tab=confirm")}
            aria-label="Back to 3PL hub"
          >
            <ArrowLeft className="size-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Dispatch summary
            </p>
            <p className="truncate text-sm font-semibold leading-tight">
              {shipment.qty}
              {unit ? ` ${unit}` : ""} · {itemName ?? "—"}
            </p>
          </div>
          {isDelivered ? (
            <CheckCircle2 className="size-5 shrink-0 text-emerald-600" />
          ) : (
            <MailCheck className="size-5 shrink-0 text-brand" />
          )}
        </div>
      </header>

      <main className="flex-1 space-y-4 px-4 pt-4 pb-10">
        {/* Status banner — explains WHY the form isn't here anymore. */}
        <section
          className={cn(
            "flex items-start gap-2 rounded-lg border p-3 text-xs leading-snug",
            isDelivered
              ? "border-emerald-500/40 bg-emerald-500/[0.06] text-emerald-900 dark:text-emerald-200"
              : "border-brand/40 bg-brand/[0.06] text-foreground",
          )}
        >
          {isDelivered ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
          ) : (
            <MailCheck className="mt-0.5 size-4 shrink-0 text-brand" />
          )}
          <p>
            {isDelivered
              ? "Delivered. The customer confirmed receipt on their portal."
              : "In transit. Waiting for the customer to confirm delivery on their portal — no more action needed on our side."}
          </p>
        </section>

        {/* Order card — shipment identity in one glance. */}
        <section className="rounded-lg border border-border/60 bg-card p-3">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Customer
              </p>
              <p className="mt-0.5 truncate text-sm">{customer ?? "—"}</p>
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Lot
              </p>
              <p className="mt-0.5 truncate font-mono text-xs">{lotCode ?? "—"}</p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border/60 pt-3 text-xs">
            <SummaryCell
              icon={<Package className="size-3.5" />}
              label="Picked up"
              value={`${shipment.picked_up_qty}${unit ? ` ${unit}` : ""} of ${shipment.qty}${unit ? ` ${unit}` : ""}`}
            />
            <SummaryCell
              icon={<Clock className="size-3.5" />}
              label="First left site"
              value={formatDateTime(shipment.picked_up_at, prefs)}
            />
          </div>
        </section>

        {/* Ship-to snapshot — the paperwork the operator confirmed. */}
        <SectionCard title="Ship to">
          <SummaryRow label="Recipient" value={shipment.recipient_name} />
          <SummaryRow
            label="Address"
            value={shipment.ship_to_address}
            multiline
          />
          <SummaryRow label="Country" value={shipment.ship_to_country} />
          <SummaryRow label="Email" value={shipment.recipient_email} />
          <SummaryRow label="Phone" value={shipment.recipient_phone} />
        </SectionCard>

        {/* Per-visit timeline — always at least one event for a
            fully picked-up shipment. Renders each truck separately so
            partial-pickup shipments show every leg. */}
        {events.length === 0 ? (
          <SectionCard title="Pickup">
            <p className="text-xs text-muted-foreground">
              No pickup event was recorded on this shipment.
            </p>
          </SectionCard>
        ) : (
          events.map((event, idx) => (
            <PickupEventCard
              key={event.uuid}
              index={idx}
              total={events.length}
              event={event}
              prefs={prefs}
              unit={unit}
            />
          ))
        )}
      </main>
    </div>
  );
}

function PickupEventCard({
  index,
  total,
  event,
  prefs,
  unit,
}: {
  index: number;
  total: number;
  event: ShipmentPickupEvent;
  prefs: CompanyDefaults | null;
  unit: string;
}) {
  const isMulti = total > 1;
  const title = isMulti ? `Truck ${index + 1} of ${total}` : "Pickup event";
  return (
    <SectionCard title={title}>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <SummaryCell
          icon={<Package className="size-3.5" />}
          label="Quantity on truck"
          value={`${event.qty}${unit ? ` ${unit}` : ""}`}
        />
        <SummaryCell
          icon={<Clock className="size-3.5" />}
          label="Left site"
          value={formatDateTime(event.picked_up_at, prefs)}
        />
      </div>
      <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
        <SummaryRow label="Carrier" value={carrierFor(event)} />
        <SummaryRow label="Driver" value={event.driver_name} />
        <SummaryRow label="Vehicle" value={event.vehicle_registration} mono />
        <SummaryRow label="CN ref" value={event.consignment_note_ref} mono />
        <SummaryRow label="Tracking" value={event.tracking_number} mono />
        <SummaryRow label="Seal" value={event.seal_number} mono />
        <SummaryRow
          label="Temperature"
          value={event.temperature_c ? `${event.temperature_c} °C` : null}
        />
        {event.picked_up_by?.name && (
          <SummaryRow label="Operator" value={event.picked_up_by.name} />
        )}
      </div>
      <div className="mt-3 space-y-1 border-t border-border/60 pt-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Truck-arrival checklist
        </p>
        <ChecklistLine label="Packaging intact" ok={event.packaging_intact} />
        <ChecklistLine
          label="Correct labels verified"
          ok={event.labels_verified}
        />
        <ChecklistLine
          label="Vehicle clean & suitable"
          ok={event.vehicle_clean_suitable}
        />
        <ChecklistLine
          label="Transport condition acceptable"
          ok={event.transport_condition_acceptable}
        />
        <ChecklistLine label="Dispatch approved" ok={event.dispatch_approved} />
      </div>
      {event.notes && (
        <div className="mt-3 border-t border-border/60 pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Notes
          </p>
          <p className="mt-1 whitespace-pre-line text-xs leading-snug">
            {event.notes}
          </p>
        </div>
      )}
      {event.photos.length > 0 && (
        <div className="mt-3 border-t border-border/60 pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Loading photos ({event.photos.length})
          </p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {event.photos.map((photo) => (
              <a
                key={photo.uuid}
                href={photo.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group relative aspect-square overflow-hidden rounded-md border border-border/60 bg-muted"
                title={photo.filename}
              >
                {photo.mime.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={photo.url}
                    alt={photo.filename}
                    className="size-full object-cover transition-opacity group-active:opacity-80"
                  />
                ) : (
                  <div className="flex size-full items-center justify-center text-muted-foreground">
                    <ImageIcon className="size-6" aria-hidden />
                  </div>
                )}
              </a>
            ))}
          </div>
        </div>
      )}
    </SectionCard>
  );
}

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border/60 bg-card p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      <div className="mt-2 space-y-2">{children}</div>
    </section>
  );
}

function SummaryRow({
  label,
  value,
  mono,
  multiline,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
  multiline?: boolean;
}) {
  const trimmed = value?.trim();
  return (
    <div className="grid grid-cols-[6.5rem_1fr] items-start gap-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p
        className={cn(
          "min-w-0 text-xs leading-snug",
          mono && "font-mono",
          !trimmed && "italic text-muted-foreground",
          multiline ? "whitespace-pre-line" : "truncate",
        )}
      >
        {trimmed || "—"}
      </p>
    </div>
  );
}

function SummaryCell({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span aria-hidden>{icon}</span>
        {label}
      </p>
      <p className="mt-0.5 truncate text-sm font-medium">{value}</p>
    </div>
  );
}

function ChecklistLine({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      {ok ? (
        <Check className="size-3.5 shrink-0 text-emerald-600" aria-hidden />
      ) : (
        <X className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      )}
      <span className={cn(!ok && "text-muted-foreground line-through")}>
        {label}
      </span>
    </div>
  );
}

function carrierFor(event: ShipmentPickupEvent): string | null {
  // Carrier isn't on ShipmentPickupEvent directly — the shipment-level
  // field is persisted from the latest event. Kept as a helper here
  // so the row degrades gracefully instead of showing "—" when the
  // event is missing the denormalised copy.
  return (event as unknown as { carrier?: string | null }).carrier ?? null;
}

function formatDateTime(
  iso: string | null,
  prefs: CompanyDefaults | null,
): string {
  if (!iso) return "—";
  const date = formatCompanyDate(iso, prefs);
  // Time-of-day is more useful on a shipment log than the timezone.
  // Formatting locally so operators see "wall clock" rather than
  // whatever ISO the server sent. en-GB matches PSP's UK default.
  try {
    const t = new Date(iso).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });
    return `${date} · ${t}`;
  } catch {
    return date;
  }
}
