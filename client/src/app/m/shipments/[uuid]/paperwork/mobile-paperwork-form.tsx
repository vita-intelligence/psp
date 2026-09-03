"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  ClipboardList,
  Loader2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  markShipmentReadyAction,
  updateShipmentAction,
} from "@/lib/shipments/actions";
import type { Shipment } from "@/lib/shipments/types";

/**
 * Mobile shipping-form. Covers the four fields the backend requires
 * to advance ``draft → ready``:
 *
 *   * recipient_name
 *   * ship_to_address
 *   * ship_to_country (2-char ISO)
 *   * planned_ship_at
 *
 * The rest of the paperwork (carrier / driver / vehicle / seal etc.)
 * lives on the truck-arrival dispatch form because those are per-
 * visit facts, not shipment defaults.
 */
export function MobilePaperworkForm({ shipment }: { shipment: Shipment }) {
  const router = useRouter();
  const [recipient, setRecipient] = useState(shipment.recipient_name ?? "");
  const [address, setAddress] = useState(shipment.ship_to_address ?? "");
  const [country, setCountry] = useState(shipment.ship_to_country ?? "");
  const [shipDate, setShipDate] = useState(
    shipment.planned_ship_at
      ? // <input type="date"> expects yyyy-mm-dd
        shipment.planned_ship_at.slice(0, 10)
      : "",
  );
  const [notes, setNotes] = useState(shipment.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const missing = useMemo(() => {
    const m: string[] = [];
    if (!recipient.trim()) m.push("Recipient name");
    if (!address.trim()) m.push("Address");
    if (!country.trim() || country.trim().length !== 2)
      m.push("Country (2-letter ISO)");
    if (!shipDate.trim()) m.push("Planned ship date");
    return m;
  }, [recipient, address, country, shipDate]);

  const canSubmit = missing.length === 0 && !pending;

  function submit() {
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      // Save the paperwork fields first, then flip status → ready.
      // Two backend hits because the ``PATCH /shipments/:uuid`` +
      // ``POST /shipments/:uuid/mark-ready`` split matches the
      // desktop flow — no new endpoint invented for mobile.
      const patchRes = await updateShipmentAction(shipment.uuid, {
        recipient_name: recipient.trim(),
        ship_to_address: address.trim(),
        ship_to_country: country.trim().toUpperCase(),
        // <input type="date"> emits yyyy-mm-dd; anchor at noon UTC
        // (matches derive_prefill_attrs on the backend).
        planned_ship_at: `${shipDate}T12:00:00Z`,
        notes: notes.trim() || null,
      });
      if (!patchRes.ok) {
        setError(patchRes.detail);
        return;
      }
      const readyRes = await markShipmentReadyAction(shipment.uuid);
      if (!readyRes.ok) {
        setError(readyRes.detail);
        return;
      }
      toast.success("Marked Ready. Truck-arrival form is up next.");
      // Route to the pickup tab so the operator sees the shipment
      // move from Paperwork to Pickup.
      router.push("/m/three-pl-dispatches?tab=pickup");
    });
  }

  const itemName = shipment.stock_lot?.item?.name ?? null;
  const lotCode = shipment.stock_lot?.code ?? null;
  const customer = shipment.customer?.name ?? null;
  const unit = shipment.stock_lot?.unit_symbol ?? "";

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center gap-2 border-b border-border/60 px-3 py-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-md p-1.5 text-muted-foreground active:bg-muted"
          aria-label="Back"
        >
          <ArrowLeft className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs uppercase tracking-wider text-muted-foreground">
            Shipment paperwork
          </p>
          <p className="truncate text-sm font-semibold">
            {shipment.qty}
            {unit ? ` ${unit}` : ""} of {itemName ?? "—"}
          </p>
        </div>
        <ClipboardList className="size-5 text-brand" />
      </header>

      <main className="flex-1 space-y-4 px-4 py-4 pb-32">
        <section className="rounded-lg border border-border/60 bg-card p-3 text-xs">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Customer
              </p>
              <p className="mt-0.5 text-sm">{customer ?? "—"}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Lot
              </p>
              <p className="mt-0.5 font-mono text-xs">{lotCode ?? "—"}</p>
            </div>
          </div>
        </section>

        <section className="space-y-1.5">
          <Label htmlFor="recipient">Recipient name</Label>
          <Input
            id="recipient"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="Who signs for it?"
            autoComplete="off"
            className="h-12 text-base"
          />
        </section>

        <section className="space-y-1.5">
          <Label htmlFor="address">Ship-to address</Label>
          <Textarea
            id="address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            rows={3}
            placeholder="Street, city, postcode…"
            className="text-base"
          />
        </section>

        <section className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="country">Country (2-letter)</Label>
            <Input
              id="country"
              value={country}
              onChange={(e) => setCountry(e.target.value.toUpperCase())}
              maxLength={2}
              autoCapitalize="characters"
              autoComplete="country"
              placeholder="GB"
              className="h-12 font-mono text-base uppercase"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ship-date">Planned ship date</Label>
            <Input
              id="ship-date"
              type="date"
              value={shipDate}
              onChange={(e) => setShipDate(e.target.value)}
              className="h-12 text-base"
            />
          </div>
        </section>

        <section className="space-y-1.5">
          <Label htmlFor="notes">
            Notes{" "}
            <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <Textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="text-base"
            placeholder="Anything the truck driver / customer should know."
          />
        </section>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/[0.06] px-3 py-2 text-xs font-medium text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>{error}</p>
          </div>
        )}

        {missing.length > 0 && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/[0.06] px-3 py-2 text-[11px] text-amber-800 dark:text-amber-200">
            Missing: {missing.join(", ")}
          </div>
        )}
      </main>

      <footer className="sticky bottom-0 border-t border-border/60 bg-background/95 px-4 py-3 backdrop-blur">
        <Button
          className="h-14 w-full text-base"
          disabled={!canSubmit}
          onClick={submit}
        >
          {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
          Save + Mark Ready for pickup
        </Button>
      </footer>
    </div>
  );
}
