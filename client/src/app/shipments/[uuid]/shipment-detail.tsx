"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  Loader2,
  MapPin,
  Package,
  Pencil,
  ShieldAlert,
  Sparkles,
  Truck,
  User as UserIcon,
  X,
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
import { Badge } from "@/components/ui/badge-mini";
import { ErrorBanner } from "@/components/forms/error-banner";
import { CountryPicker } from "@/components/forms/country-picker";
import { CommentThread } from "@/components/comments/comment-thread";
import { AuditHistoryCard } from "@/components/audit/audit-history-card";
import { useFormPresenceBeacon } from "@/lib/realtime/use-form-presence-beacon";
import { formatCompanyDate } from "@/lib/format/company";
import { findCountry } from "@/lib/iso/countries";
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
  ShipmentStatus,
} from "@/lib/shipments/types";
import type { Comment } from "@/lib/comments/types";
import type { CompanyDefaults } from "@/lib/types";

interface Props {
  shipment: Shipment;
  companyDefaults: CompanyDefaults | null;
  initialComments: Comment[];
  currentUserId: number;
  canComment: boolean;
  canEdit: boolean;
}

interface FormState {
  recipient_name: string;
  ship_to_address: string;
  ship_to_country: string | null;
  planned_ship_at: string;
  notes: string;
  qty: string;
}

function initialFrom(s: Shipment): FormState {
  return {
    recipient_name: s.recipient_name ?? "",
    ship_to_address: s.ship_to_address ?? "",
    ship_to_country: s.ship_to_country ?? null,
    planned_ship_at: s.planned_ship_at ? s.planned_ship_at.slice(0, 16) : "",
    notes: s.notes ?? "",
    qty: s.qty ?? "",
  };
}

function toEditable(state: FormState): ShipmentEditableFields {
  return {
    recipient_name: state.recipient_name || null,
    ship_to_address: state.ship_to_address || null,
    ship_to_country: state.ship_to_country || null,
    planned_ship_at: state.planned_ship_at
      ? new Date(state.planned_ship_at).toISOString()
      : null,
    notes: state.notes || null,
    qty: state.qty,
  };
}

export function ShipmentDetail({
  shipment,
  companyDefaults,
  initialComments,
  currentUserId,
  canComment,
  canEdit,
}: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [state, setState] = useState<FormState>(() => initialFrom(shipment));
  const [error, setError] = useState<ErrorResult | null>(null);
  const [saving, startSave] = useTransition();
  const [busy, startTransition] = useTransition();

  useFormPresenceBeacon(`shipment:${shipment.uuid}`);

  // Reset local form + close edit mode whenever the server payload
  // changes (e.g. after Mark ready refreshes the row).
  useEffect(() => {
    setState(initialFrom(shipment));
    setEditing(false);
    setError(null);
  }, [shipment]);

  const editable = shipment.status === "draft" || shipment.status === "ready";
  const finalized =
    shipment.status === "picked_up" || shipment.status === "cancelled";
  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setState((prev) => ({ ...prev, [key]: value }));

  const original = useMemo(() => initialFrom(shipment), [shipment]);
  const dirty = JSON.stringify(state) !== JSON.stringify(original);

  const autofillFromCustomer = () => {
    const c = shipment.customer;
    if (!c) return;
    setState((prev) => ({
      ...prev,
      recipient_name: prev.recipient_name || c.name,
      ship_to_address: prev.ship_to_address || c.legal_address || "",
      ship_to_country: prev.ship_to_country || c.country_code || null,
    }));
    toast.success("Filled from the customer record.");
  };

  const save = () => {
    setError(null);
    startSave(async () => {
      const res = await updateShipmentAction(shipment.uuid, toEditable(state));
      if (!res.ok) {
        setError(res);
        return;
      }
      toast.success("Shipment saved.");
      setEditing(false);
      router.refresh();
    });
  };

  const discard = () => {
    setState(original);
    setEditing(false);
    setError(null);
  };

  const markReady = () =>
    startTransition(async () => {
      const res = await markShipmentReadyAction(shipment.uuid);
      if (!res.ok) {
        setError(res);
        return;
      }
      toast.success("Ready for pickup.");
      router.refresh();
    });

  const markDraft = () =>
    startTransition(async () => {
      const res = await markShipmentDraftAction(shipment.uuid);
      if (!res.ok) {
        setError(res);
        return;
      }
      toast.info("Reopened for edits.");
      router.refresh();
    });

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

  const lotHref = lotDetailHref(shipment);
  const customerHref = shipment.customer
    ? `/sales/customers/${encodeURIComponent(shipment.customer.uuid)}`
    : null;
  const orderHref = shipment.customer_order
    ? `/projects/${encodeURIComponent(shipment.customer_order.uuid)}`
    : null;

  return (
    // pb-24 keeps the last card clear of the sticky action bar
    <div
      className={cn(
        "space-y-4",
        !finalized && canEdit && "pb-24",
      )}
    >
      <StatusBanner shipment={shipment} companyDefaults={companyDefaults} />

      {error && <ErrorBanner detail={error.detail} code={error.code} />}

      {/* -------- Goods -------- */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Package className="size-4" />
            Goods on this shipment
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <DetailRow
            label="Item"
            value={shipment.stock_lot?.item?.name ?? "—"}
          />
          <DetailRow
            label="Lot"
            value={
              lotHref && shipment.stock_lot?.code ? (
                <Link
                  href={lotHref}
                  className="inline-flex items-center gap-1 font-mono text-brand hover:underline"
                >
                  {shipment.stock_lot.code}
                  <ExternalLink className="size-3" />
                </Link>
              ) : (
                <span className="font-mono">
                  {shipment.stock_lot?.code ?? "—"}
                </span>
              )
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
            value={
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3" />
                {placementLabel(shipment.stock_lot?.placement)}
              </span>
            }
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
          <DetailRow
            label="Customer"
            value={
              customerHref && shipment.customer ? (
                <Link
                  href={customerHref}
                  className="inline-flex items-center gap-1 text-brand hover:underline"
                >
                  {shipment.customer.name}
                  <ExternalLink className="size-3" />
                </Link>
              ) : (
                (shipment.customer?.name ?? "—")
              )
            }
          />
          <DetailRow
            label="Order"
            value={
              orderHref && shipment.customer_order ? (
                <Link
                  href={orderHref}
                  className="inline-flex items-center gap-1 text-brand hover:underline"
                >
                  Open in projects
                  <ExternalLink className="size-3" />
                </Link>
              ) : (
                "—"
              )
            }
          />
        </CardContent>
      </Card>

      {/* -------- Delivery card (view / edit toggle) -------- */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle className="text-sm">Delivery</CardTitle>
              <p className="text-xs text-muted-foreground">
                What we know before the truck arrives. Everything else is
                captured on the mobile truck-arrival flow (spec pending).
              </p>
            </div>
            {editable && canEdit && (
              <div className="flex flex-wrap items-center gap-2">
                {editing && shipment.customer && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={autofillFromCustomer}
                    title="Copy recipient + address + country from the customer record."
                  >
                    <Sparkles className="mr-1 size-3.5" />
                    Fill from customer
                  </Button>
                )}
                {editing ? (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={discard}
                      disabled={saving}
                    >
                      <X className="mr-1 size-3.5" />
                      Discard
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={!dirty || saving}
                      onClick={save}
                    >
                      {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
                      Save
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setEditing(true)}
                  >
                    <Pencil className="mr-1 size-3.5" />
                    Edit
                  </Button>
                )}
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {editing ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Recipient" htmlFor="recipient_name">
                <Input
                  id="recipient_name"
                  value={state.recipient_name}
                  onChange={(e) => setField("recipient_name", e.target.value)}
                  placeholder="e.g. Acme Ltd receiving desk"
                />
              </Field>
              <Field label="Country" htmlFor="ship_to_country">
                <CountryPicker
                  id="ship_to_country"
                  value={state.ship_to_country}
                  onChange={(code) => setField("ship_to_country", code)}
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
                />
              </Field>
              <Field label="Qty" htmlFor="qty">
                <Input
                  id="qty"
                  type="number"
                  step="0.0001"
                  value={state.qty}
                  onChange={(e) => setField("qty", e.target.value)}
                />
              </Field>
              <Field
                label="Notes"
                htmlFor="notes"
                className="sm:col-span-2"
              >
                <Textarea
                  id="notes"
                  value={state.notes}
                  onChange={(e) => setField("notes", e.target.value)}
                  rows={2}
                  placeholder="Anything the truck arrival team should know."
                />
              </Field>
            </div>
          ) : (
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <DetailRow
                label="Recipient"
                value={shipment.recipient_name ?? "—"}
              />
              <DetailRow
                label="Country"
                value={countryLabel(shipment.ship_to_country)}
              />
              <DetailRow
                label="Delivery address"
                value={
                  shipment.ship_to_address ? (
                    <span className="whitespace-pre-line">
                      {shipment.ship_to_address}
                    </span>
                  ) : (
                    "—"
                  )
                }
                span={2}
              />
              <DetailRow
                label="Planned ship time"
                value={
                  shipment.planned_ship_at
                    ? new Date(shipment.planned_ship_at).toLocaleString()
                    : "—"
                }
              />
              <DetailRow
                label="Qty"
                value={
                  <span className="font-mono">
                    {shipment.qty}
                    {shipment.stock_lot?.unit_symbol
                      ? ` ${shipment.stock_lot.unit_symbol}`
                      : ""}
                  </span>
                }
              />
              <DetailRow
                label="Notes"
                value={
                  shipment.notes ? (
                    <span className="whitespace-pre-line">{shipment.notes}</span>
                  ) : (
                    "—"
                  )
                }
                span={2}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* -------- Truck arrival (always read-only) -------- */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Truck className="size-4" />
            Truck arrival
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Vehicle registration, driver, waybill, seal, temperature, and
            loading photo land here when the mobile truck-arrival form runs
            (spec pending). Rows show &ldquo;—&rdquo; until then.
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <DetailRow label="Carrier" value={shipment.carrier ?? "—"} />
          <DetailRow
            label="Vehicle registration"
            value={shipment.vehicle_registration ?? "—"}
            mono
          />
          <DetailRow label="Driver" value={shipment.driver_name ?? "—"} />
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
          {shipment.loading_photo_url ? (
            <div className="sm:col-span-2">
              <p className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                Loading photo
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <a
                href={shipment.loading_photo_url}
                target="_blank"
                rel="noopener"
              >
                <img
                  src={shipment.loading_photo_url}
                  alt="Loading evidence"
                  className="max-h-56 rounded-md border border-border/60"
                />
              </a>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* -------- Timeline -------- */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ClipboardList className="size-4" />
            Timeline
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <TimelineRow
            label="Created"
            when={shipment.created_at}
            who={shipment.created_by?.name}
            companyDefaults={companyDefaults}
          />
          <TimelineRow
            label="Marked ready"
            when={shipment.ready_at}
            who={shipment.ready_by?.name}
            companyDefaults={companyDefaults}
          />
          <TimelineRow
            label="Picked up"
            when={shipment.picked_up_at}
            who={shipment.picked_up_by?.name}
            companyDefaults={companyDefaults}
          />
          {shipment.status === "cancelled" && (
            <TimelineRow
              label={`Cancelled${
                shipment.cancel_reason ? ` — ${shipment.cancel_reason}` : ""
              }`}
              when={shipment.cancelled_at}
              who={shipment.cancelled_by?.name}
              companyDefaults={companyDefaults}
            />
          )}
        </CardContent>
      </Card>

      {/* -------- Activity (detailed audit log) -------- */}
      <AuditHistoryCard entityType="shipment" entityId={shipment.id} />

      {/* -------- Discussion — CommentThread has its own header,
                  so no outer Card wrapper.               -------- */}
      <CommentThread
        entityType="shipment"
        entityUuid={shipment.uuid}
        initial={initialComments}
        canComment={canComment}
        currentUserId={currentUserId}
      />

      {/* -------- Sticky action bar -------- */}
      {!finalized && canEdit && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border/60 bg-background/95 shadow-lg backdrop-blur">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 px-4 py-3 sm:px-8">
            {shipment.status === "draft" && (
              <Button
                variant="outline"
                onClick={markReady}
                disabled={busy || editing || dirty}
                title={
                  editing || dirty
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
                <Button
                  variant="outline"
                  onClick={markDraft}
                  disabled={busy}
                >
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
          </div>
        </div>
      )}
    </div>
  );
}

// ================================================================
// Sub-components
// ================================================================

const STATUS_META: Record<
  ShipmentStatus,
  {
    title: string;
    body: (s: Shipment, cd: CompanyDefaults | null) => string;
    Icon: typeof CheckCircle2;
    cls: string;
    badge: "muted" | "sky" | "emerald" | "destructive";
  }
> = {
  draft: {
    title: "Draft — paperwork in progress",
    body: () =>
      "Fill recipient + delivery address + country. Mark ready once those three are captured; the mobile truck-arrival flow will handle vehicle registration + driver + waybill + seal + photo when it lands.",
    Icon: ShieldAlert,
    cls: "border-border/60 bg-muted/40",
    badge: "muted",
  },
  ready: {
    title: "Ready for pickup",
    body: (s, cd) =>
      `Marked ready ${
        s.ready_at ? formatCompanyDate(s.ready_at, cd) : ""
      } by ${s.ready_by?.name ?? "—"}. Waiting for the truck.`,
    Icon: CheckCircle2,
    cls: "border-sky-500/40 bg-sky-500/5",
    badge: "sky",
  },
  picked_up: {
    title: "Picked up",
    body: (s, cd) =>
      `Left the warehouse ${
        s.picked_up_at ? formatCompanyDate(s.picked_up_at, cd) : ""
      } via ${s.picked_up_by?.name ?? "—"}. Record is immutable.`,
    Icon: Truck,
    cls: "border-emerald-500/40 bg-emerald-500/5",
    badge: "emerald",
  },
  cancelled: {
    title: "Cancelled",
    body: (s) =>
      `Cancelled by ${s.cancelled_by?.name ?? "—"}${
        s.cancel_reason ? ` — ${s.cancel_reason}` : ""
      }.`,
    Icon: XCircle,
    cls: "border-destructive/40 bg-destructive/5",
    badge: "destructive",
  },
};

function StatusBanner({
  shipment,
  companyDefaults,
}: {
  shipment: Shipment;
  companyDefaults: CompanyDefaults | null;
}) {
  const meta = STATUS_META[shipment.status];
  const { Icon } = meta;
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
        meta.cls,
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="font-semibold">{meta.title}</p>
          <Badge tone={meta.badge}>{shipment.status}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {meta.body(shipment, companyDefaults)}
        </p>
      </div>
    </div>
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
  span,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  span?: 1 | 2;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(120px,1fr)_2fr] items-baseline gap-2",
        span === 2 && "sm:col-span-2",
      )}
    >
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className={cn("text-sm", mono && "font-mono text-xs")}>
        {value}
      </span>
    </div>
  );
}

function TimelineRow({
  label,
  when,
  who,
  companyDefaults,
}: {
  label: string;
  when: string | null | undefined;
  who: string | null | undefined;
  companyDefaults: CompanyDefaults | null;
}) {
  return (
    <div className="rounded-md border border-border/40 bg-background p-2 text-xs">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        <UserIcon className="size-3" />
        {label}
      </div>
      <p className="mt-0.5 text-sm">{who ?? "—"}</p>
      <p className="text-[11px] text-muted-foreground">
        {when ? formatCompanyDate(when, companyDefaults) : "not yet"}
      </p>
    </div>
  );
}

function countryLabel(code: string | null | undefined): string {
  if (!code) return "—";
  const country = findCountry(code);
  return country ? `${country.name} (${country.code})` : code;
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

// Lots in bailee custody live under /three-pl; own stock lives under
// /stock/lots. Send the operator to whichever detail page carries the
// context they actually need.
function lotDetailHref(shipment: Shipment): string | null {
  const lot = shipment.stock_lot;
  if (!lot) return null;
  if (lot.ownership_kind === "bailee") {
    return `/three-pl/${encodeURIComponent(lot.uuid)}`;
  }
  return `/stock/lots/${encodeURIComponent(lot.uuid)}`;
}
