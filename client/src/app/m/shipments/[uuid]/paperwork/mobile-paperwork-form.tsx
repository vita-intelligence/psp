"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  ClipboardList,
  Loader2,
  Mail,
  MapPin,
  Phone,
  User,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CountryPicker } from "@/components/forms/country-picker";
import { DateField } from "@/components/forms/date-field";
import {
  markShipmentReadyAction,
  updateShipmentAction,
} from "@/lib/shipments/actions";
import type { Shipment } from "@/lib/shipments/types";
import type { CompanyDefaults } from "@/lib/types";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Mobile shipping-form. Matches the field set the portal dispatch
 * dialog captures so bailee shipments are ready-for-Ready with the
 * same recipient snapshot the customer typed in:
 *
 *   * recipient_name
 *   * ship_to_address
 *   * ship_to_country (ISO 3166-1 alpha-2 via CountryPicker)
 *   * recipient_email (couriers refuse the drop without it)
 *   * recipient_phone (same)
 *   * planned_ship_at
 *
 * The rest of the paperwork (carrier / driver / vehicle / seal etc.)
 * lives on the truck-arrival dispatch form because those are per-
 * visit facts, not shipment defaults.
 */
export function MobilePaperworkForm({
  shipment,
  prefs,
}: {
  shipment: Shipment;
  prefs: CompanyDefaults | null;
}) {
  const router = useRouter();
  const [recipient, setRecipient] = useState(shipment.recipient_name ?? "");
  const [email, setEmail] = useState(shipment.recipient_email ?? "");
  const [phone, setPhone] = useState(shipment.recipient_phone ?? "");
  const [address, setAddress] = useState(shipment.ship_to_address ?? "");
  const [country, setCountry] = useState<string | null>(
    shipment.ship_to_country ?? null,
  );
  const [shipDate, setShipDate] = useState<string | null>(
    // ISO ``yyyy-mm-dd`` slice matches what DateField round-trips.
    shipment.planned_ship_at
      ? shipment.planned_ship_at.slice(0, 10)
      : null,
  );
  const [notes, setNotes] = useState(shipment.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const missing = useMemo(() => {
    const m: string[] = [];
    if (!recipient.trim()) m.push("Recipient name");
    if (!address.trim()) m.push("Address");
    if (!country || country.trim().length !== 2) m.push("Country");
    if (!email.trim() || !EMAIL_RE.test(email.trim()))
      m.push(email.trim() ? "Valid email" : "Recipient email");
    if (!phone.trim() || phone.trim().length < 6) m.push("Recipient phone");
    if (!shipDate) m.push("Planned ship date");
    return m;
  }, [recipient, address, country, email, phone, shipDate]);

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
        recipient_email: email.trim(),
        recipient_phone: phone.trim(),
        ship_to_address: address.trim(),
        ship_to_country: (country ?? "").trim().toUpperCase(),
        // DateField emits ``yyyy-mm-dd``; anchor at noon UTC
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
    // ``overflow-x-clip`` (not ``-hidden``) so the sticky header +
    // footer keep working — hidden establishes a scroll container
    // that kills position: sticky descendants. Belt-and-braces
    // for the ``<input type="date">`` iOS quirk below.
    <div className="flex min-h-dvh flex-col overflow-x-clip">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-border/60 bg-background/95 px-3 py-2.5 backdrop-blur">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-md p-1.5 text-muted-foreground active:bg-muted"
          aria-label="Back"
        >
          <ArrowLeft className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Shipment paperwork
          </p>
          <p className="truncate text-sm font-semibold leading-tight">
            {shipment.qty}
            {unit ? ` ${unit}` : ""} · {itemName ?? "—"}
          </p>
        </div>
        <ClipboardList className="size-5 shrink-0 text-brand" />
      </header>

      <main className="flex-1 space-y-5 px-4 pt-4 pb-36">
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
              <p className="mt-0.5 truncate font-mono text-xs">
                {lotCode ?? "—"}
              </p>
            </div>
          </div>
        </section>

        <FieldGroup icon={<User className="size-3.5" />} title="Recipient">
          <div className="space-y-1.5">
            <RequiredLabel htmlFor="recipient">Full name</RequiredLabel>
            <Input
              id="recipient"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="Who signs for it?"
              autoComplete="name"
              required
              className="h-12 text-base"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <RequiredLabel htmlFor="recipient-email">
                <span className="inline-flex items-center gap-1.5">
                  <Mail className="size-3.5 text-muted-foreground" />
                  Email
                </span>
              </RequiredLabel>
              <Input
                id="recipient-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                maxLength={200}
                required
                className="h-12 text-base"
              />
            </div>
            <div className="space-y-1.5">
              <RequiredLabel htmlFor="recipient-phone">
                <span className="inline-flex items-center gap-1.5">
                  <Phone className="size-3.5 text-muted-foreground" />
                  Phone
                </span>
              </RequiredLabel>
              <Input
                id="recipient-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+44 7700 900123"
                maxLength={60}
                minLength={6}
                required
                className="h-12 text-base"
              />
            </div>
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground">
            Couriers need both email and phone at drop-off — post offices
            refuse the parcel without them.
          </p>
        </FieldGroup>

        <FieldGroup
          icon={<MapPin className="size-3.5" />}
          title="Delivery address"
        >
          <div className="space-y-1.5">
            <RequiredLabel htmlFor="address">Street, city, postcode</RequiredLabel>
            <Textarea
              id="address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              rows={3}
              placeholder="e.g. 123 High Street, London, SW1A 1AA"
              autoComplete="street-address"
              required
              className="text-base"
            />
          </div>

          <div className="space-y-1.5">
            <RequiredLabel htmlFor="country">Country</RequiredLabel>
            <CountryPicker
              id="country"
              value={country}
              onChange={setCountry}
              allowClear={false}
              placeholder="Pick a country…"
              className="h-12 text-base"
            />
          </div>
        </FieldGroup>

        <FieldGroup
          icon={<ClipboardList className="size-3.5" />}
          title="Dispatch details"
        >
          <div className="space-y-1.5">
            <RequiredLabel htmlFor="ship-date">Planned ship date</RequiredLabel>
            {/* Custom picker (bottom-sheet calendar) — native
                ``<input type="date">`` on iOS refuses to shrink
                below its intrinsic ``mm/dd/yyyy`` content width
                and blows the form into horizontal scroll. */}
            <DateField
              id="ship-date"
              value={shipDate}
              onChange={setShipDate}
              prefs={prefs}
              placeholder="Pick a date…"
              className="h-12 text-base"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes" className="text-xs">
              Notes{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="text-base"
              placeholder="Anything the truck driver / customer should know."
            />
          </div>
        </FieldGroup>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/[0.06] px-3 py-2 text-xs font-medium text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>{error}</p>
          </div>
        )}

        {missing.length > 0 && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/[0.06] px-3 py-2 text-[11px] leading-snug text-amber-800 dark:text-amber-200">
            Missing: {missing.join(", ")}
          </div>
        )}
      </main>

      <footer
        className="sticky bottom-0 border-t border-border/60 bg-background/95 px-4 py-3 backdrop-blur"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
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

// Section wrapper — small icon + title chip above a stack of fields.
// Keeps the form scannable on a phone where full-width labels start
// to blur together.
function FieldGroup({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span aria-hidden className="text-brand">
          {icon}
        </span>
        {title}
      </div>
      {children}
    </section>
  );
}

// Label with a red asterisk to mark required fields. Kept small
// so the label doesn't compete with the input for attention.
function RequiredLabel({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <Label htmlFor={htmlFor} className="text-xs">
      {children} <span className="text-destructive">*</span>
    </Label>
  );
}
