"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  Loader2,
  Trash2,
  Truck,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { confirmShipmentPickupAction } from "@/lib/shipments/actions";
import type {
  Shipment,
  ShipmentPickupChecklist,
  ShipmentPickupFile,
} from "@/lib/shipments/types";

interface Props {
  shipment: Shipment;
}

type ChecklistKey = Exclude<
  keyof ShipmentPickupChecklist,
  "carrier" | "vehicle_registration"
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

export function MobileDispatchForm({ shipment }: Props) {
  const router = useRouter();
  const [carrier, setCarrier] = useState(shipment.carrier ?? "");
  const [vehicleReg, setVehicleReg] = useState(
    shipment.vehicle_registration ?? "",
  );
  const [checks, setChecks] = useState<Record<ChecklistKey, boolean>>({
    packaging_intact: shipment.packaging_intact === true,
    labels_verified: shipment.labels_verified === true,
    vehicle_clean_suitable: shipment.vehicle_clean_suitable === true,
    transport_condition_acceptable:
      shipment.transport_condition_acceptable === true,
    dispatch_approved: shipment.dispatch_approved === true,
  });
  const [files, setFiles] = useState<ShipmentPickupFile[]>(
    shipment.pickup_files ?? [],
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

  const missing: string[] = [];
  if (!carrier.trim()) missing.push("Delivery company");
  if (!vehicleReg.trim()) missing.push("Vehicle registration");
  for (const item of CHECKLIST) {
    if (!checks[item.key]) missing.push(item.label);
  }
  if (files.length === 0) missing.push("At least one photo of the load");

  const canSubmit = missing.length === 0 && !pending && !uploading;

  function onSubmit() {
    setSubmitError(null);
    startTransition(async () => {
      const payload: ShipmentPickupChecklist = {
        carrier: carrier.trim(),
        vehicle_registration: vehicleReg.trim(),
        packaging_intact: checks.packaging_intact,
        labels_verified: checks.labels_verified,
        vehicle_clean_suitable: checks.vehicle_clean_suitable,
        transport_condition_acceptable: checks.transport_condition_acceptable,
        dispatch_approved: checks.dispatch_approved,
      };
      const res = await confirmShipmentPickupAction(shipment.uuid, payload);
      if (!res.ok) {
        setSubmitError(res.detail);
        return;
      }
      toast.success("Dispatch confirmed.");
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
        <section className="grid grid-cols-1 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="carrier">Delivery company</Label>
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
