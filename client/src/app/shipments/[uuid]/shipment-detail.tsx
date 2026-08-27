"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  ClipboardList,
  ExternalLink,
  FileText,
  Hourglass,
  Loader2,
  Lock,
  LockKeyhole,
  MapPin,
  Package,
  PackageCheck,
  Paperclip,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge-mini";
import { ErrorBanner } from "@/components/forms/error-banner";
import { CountryPicker } from "@/components/forms/country-picker";
import { CommentThread } from "@/components/comments/comment-thread";
import { AuditHistoryCard } from "@/components/audit/audit-history-card";
import { CollabAvatars } from "@/components/realtime/collab-avatars";
import { FieldEditingIndicator } from "@/components/realtime/field-editing-indicator";
import { RemoteCursor } from "@/components/realtime/remote-cursor";
import { useLiveForm } from "@/lib/realtime/use-live-form";
import type { CollabPeer, JoinError } from "@/lib/realtime/use-live-form";
import {
  formatCompanyDate,
  formatCompanyMoney,
  formatCompanyNumber,
} from "@/lib/format/company";
import { findCountry } from "@/lib/iso/countries";
import { cn } from "@/lib/utils";
import {
  cancelShipmentAction,
  confirmPickupEventDeliveryAction,
  confirmShipmentDeliveryAction,
  logShipmentPickupEventAction,
  markShipmentDraftAction,
  markShipmentReadyAction,
  updatePickupEventPaperworkAction,
  updateShipmentAction,
  updateShipmentCarrierDetailsAction,
} from "@/lib/shipments/actions";
import type { ErrorResult } from "@/lib/errors/server";
import type {
  Shipment,
  ShipmentCarrierEditableFields,
  ShipmentDeliveryFile,
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
  canPickup: boolean;
  canConfirmDelivery: boolean;
}

// Split across two edit cards on the page so the desk has a focused
// context per task:
//
//   * Ship-to & schedule — recipient / address / country / planned
//     ship time / qty / notes. Locks at ``picked_up`` (BE enforces).
//   * Carrier & vehicle — delivery company / vehicle registration /
//     driver / waybill / tracking / seal / temperature. Stays
//     editable through ``picked_up`` via the carrier-details endpoint
//     because these values routinely need corrections after the
//     truck departs (typo on the plate, driver swap, tracking issued
//     late by the carrier).
//
// Both sections share one useLiveForm room so peer presence + head-
// of-room + cursors work across the page. Each card has its own
// Edit / Save / Discard toggle, dirty check, and save action.
interface FormState {
  // Ship-to & schedule
  recipient_name: string;
  ship_to_address: string;
  ship_to_country: string | null;
  planned_ship_at: string;
  notes: string;
  qty: string;
  // Carrier & vehicle
  carrier: string;
  vehicle_registration: string;
  driver_name: string;
  consignment_note_ref: string;
  tracking_number: string;
  seal_number: string;
  temperature_c: string;
}

// Keys owned by each edit card — used to compute per-section dirty
// state so each Save button only lights up for its own edits.
const SHIP_TO_KEYS = [
  "recipient_name",
  "ship_to_address",
  "ship_to_country",
  "planned_ship_at",
  "notes",
  "qty",
] as const satisfies readonly (keyof FormState)[];

const CARRIER_KEYS = [
  "carrier",
  "vehicle_registration",
  "driver_name",
  "consignment_note_ref",
  "tracking_number",
  "seal_number",
  "temperature_c",
] as const satisfies readonly (keyof FormState)[];

function initialFrom(s: Shipment): FormState {
  return {
    recipient_name: s.recipient_name ?? "",
    ship_to_address: s.ship_to_address ?? "",
    ship_to_country: s.ship_to_country ?? null,
    planned_ship_at: s.planned_ship_at ? s.planned_ship_at.slice(0, 16) : "",
    notes: s.notes ?? "",
    qty: s.qty ?? "",
    carrier: s.carrier ?? "",
    vehicle_registration: s.vehicle_registration ?? "",
    driver_name: s.driver_name ?? "",
    consignment_note_ref: s.consignment_note_ref ?? "",
    tracking_number: s.tracking_number ?? "",
    seal_number: s.seal_number ?? "",
    temperature_c: s.temperature_c ?? "",
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

function toCarrierEditable(state: FormState): ShipmentCarrierEditableFields {
  return {
    carrier: state.carrier || null,
    vehicle_registration: state.vehicle_registration || null,
    driver_name: state.driver_name || null,
    consignment_note_ref: state.consignment_note_ref || null,
    tracking_number: state.tracking_number || null,
    seal_number: state.seal_number || null,
    temperature_c: state.temperature_c || null,
  };
}

function subsetEqual<K extends keyof FormState>(
  a: FormState,
  b: FormState,
  keys: readonly K[],
): boolean {
  for (const k of keys) if (a[k] !== b[k]) return false;
  return true;
}

export function ShipmentDetail({
  shipment,
  companyDefaults,
  initialComments,
  currentUserId,
  canComment,
  canEdit,
  canPickup,
  canConfirmDelivery,
}: Props) {
  const router = useRouter();
  const [editingShipTo, setEditingShipTo] = useState(false);
  const [editingCarrier, setEditingCarrier] = useState(false);
  const [error, setError] = useState<ErrorResult | null>(null);
  const [savingShipTo, startSaveShipTo] = useTransition();
  const [savingCarrier, startSaveCarrier] = useTransition();
  const [busy, startTransition] = useTransition();

  const initialState = useMemo(() => initialFrom(shipment), [shipment]);

  // HARD RULE: every editable form is realtime + collaborative. The
  // channel is gated on `shipments.edit` server-side; view-only
  // viewers skip the join via `disabled: !canEdit`.
  const {
    state,
    setField,
    resetState,
    presence,
    fieldEditors,
    focusField,
    blurField,
    joinError,
    creator,
    isCreator,
    cursors,
    setCursor,
    hideCursor,
    broadcastCommit,
  } = useLiveForm<FormState>({
    resource: `shipment:${shipment.uuid}`,
    disabled: !canEdit,
    initialState,
    onCommit: () => {
      // Any peer save → refetch to pick up fresh server state.
      router.refresh();
    },
  });

  // Reset live-form state + close both edit modes whenever the
  // server payload changes (e.g. after Mark ready refreshes the row).
  useEffect(() => {
    resetState(initialFrom(shipment));
    setEditingShipTo(false);
    setEditingCarrier(false);
    setError(null);
  }, [shipment, resetState]);

  const cursorAnchorRef = useRef<HTMLDivElement | null>(null);
  const [anchorSize, setAnchorSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = cursorAnchorRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setAnchorSize({ w: rect.width, h: rect.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Ship-to & schedule locks at pickup — recipient / address / qty
  // integrity must not drift once the goods are in transit (BE
  // ``ensure_editable`` gates on draft|ready).
  const shipToEditable =
    shipment.status === "draft" || shipment.status === "ready";
  // Carrier & vehicle stays editable through pickup because carrier
  // paperwork routinely needs corrections after departure. Locks at
  // delivered / cancelled. Perm gate is state-dependent (mirrors BE
  // ``ensure_carrier_perm``): shipments.edit pre-pickup,
  // shipments.pickup post-pickup.
  const carrierEditable =
    shipment.status === "draft" ||
    shipment.status === "ready" ||
    shipment.status === "picked_up";
  const carrierPermHolder =
    shipment.status === "picked_up" ? canPickup : canEdit;
  // Terminal states — action bar hides everything except the trailing
  // Cancel button. `picked_up` used to be terminal here, but now that
  // delivery is a real event the desktop team logs, we keep the bar
  // open through `picked_up` (Confirm delivery lives inside a dedicated
  // card, not the sticky bar) and only close it on delivered/cancelled.
  const finalized =
    shipment.status === "delivered" || shipment.status === "cancelled";

  const original = useMemo(() => initialFrom(shipment), [shipment]);
  const dirtyShipTo = !subsetEqual(state, original, SHIP_TO_KEYS);
  const dirtyCarrier = !subsetEqual(state, original, CARRIER_KEYS);
  const dirty = dirtyShipTo || dirtyCarrier;
  // Head-of-room lock. Non-heads can join + watch, but only the
  // creator (first joiner) can Save / Mark ready / Reopen / Cancel.
  // Pickup is a separate physical event — gated on canPickup, not
  // isCreator, since whoever's at the desk when the truck rolls in
  // hits the button.
  const canDrive = canEdit && isCreator;
  // Carrier edits need head-of-room too (single source of truth for
  // save order) AND the right per-state perm. Post-pickup a user
  // with shipments.pickup but not shipments.edit still needs to be
  // head — they can join first + take over head naturally.
  const canDriveCarrier = carrierPermHolder && isCreator;

  // Paperwork checklist mirrored by the backend's `validate_ready_prereqs`.
  // Kept in step with `Backend.Shipments.Shipment.ready_changeset/2` so a
  // Mark-ready click that would 422 is impossible in the UI — the button
  // stays disabled and the tooltip lists what's missing.
  const missingReadyFields = (() => {
    const missing: string[] = [];
    if (!shipment.recipient_name?.trim()) missing.push("Recipient");
    if (!shipment.ship_to_country?.trim()) missing.push("Country");
    if (!shipment.ship_to_address?.trim()) missing.push("Delivery address");
    if (!shipment.planned_ship_at) missing.push("Planned ship time");
    if (!shipment.qty || Number(shipment.qty) <= 0) missing.push("Qty");
    return missing;
  })();
  const readyReady = missingReadyFields.length === 0;

  const autofillFromCustomer = () => {
    const c = shipment.customer;
    const co = shipment.customer_order;
    // Auto-fill empty fields only — never stomp a manual override.
    // Address resolution: prefer the CO's ``delivery_address`` (that's
    // what the customer typed into /portal/settings on the website
    // and NPD mirrors to us via the sync), fall back to the customer's
    // ``legal_address`` for accounts synced from a PSP-native flow.
    let filled = 0;
    if (!state.recipient_name && c?.name) {
      setField("recipient_name", c.name);
      filled++;
    }
    if (!state.ship_to_address) {
      const addr = co?.delivery_address || c?.legal_address || null;
      if (addr) {
        setField("ship_to_address", addr);
        filled++;
      }
    }
    if (!state.ship_to_country && c?.country_code) {
      setField("ship_to_country", c.country_code);
      filled++;
    }
    if (filled === 0) {
      toast.info(
        "Nothing to fill — either the fields are already set or the customer profile doesn't have an address on file yet.",
      );
      return;
    }
    toast.success("Filled from the customer profile.");
  };

  const saveShipTo = () => {
    setError(null);
    startSaveShipTo(async () => {
      const res = await updateShipmentAction(shipment.uuid, toEditable(state));
      if (!res.ok) {
        setError(res);
        return;
      }
      toast.success("Ship-to & schedule saved.");
      setEditingShipTo(false);
      broadcastCommit({ kind: "shipment-updated" });
      router.refresh();
    });
  };

  const discardShipTo = () => {
    // Reset only the ship-to keys — leave carrier edits alone so
    // the operator doesn't lose in-flight work in the other card.
    const next: FormState = { ...state };
    for (const k of SHIP_TO_KEYS) {
      (next as unknown as Record<string, unknown>)[k] = original[k];
    }
    resetState(next);
    setEditingShipTo(false);
    setError(null);
  };

  const saveCarrier = () => {
    setError(null);
    startSaveCarrier(async () => {
      const res = await updateShipmentCarrierDetailsAction(
        shipment.uuid,
        toCarrierEditable(state),
      );
      if (!res.ok) {
        setError(res);
        return;
      }
      toast.success("Carrier & vehicle saved.");
      setEditingCarrier(false);
      broadcastCommit({ kind: "shipment-updated" });
      router.refresh();
    });
  };

  const discardCarrier = () => {
    const next: FormState = { ...state };
    for (const k of CARRIER_KEYS) {
      (next as unknown as Record<string, unknown>)[k] = original[k];
    }
    resetState(next);
    setEditingCarrier(false);
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
      broadcastCommit({ kind: "shipment-updated" });
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
      broadcastCommit({ kind: "shipment-updated" });
      router.refresh();
    });

  // Dispatch is a phone-only flow (camera, on-the-dock ergonomics).
  // The desktop button pings the operator's paired mobile via a
  // `user:<uuid>` channel broadcast; the mobile shell shows a slide-up
  // "Open dispatch form" banner. Desktop just gets a toast so the
  // operator knows the ping landed.
  const [pushingDispatch, setPushingDispatch] = useState(false);
  const pushDispatchToPhone = () => {
    setPushingDispatch(true);
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/shipments/${encodeURIComponent(shipment.uuid)}/dispatch-push`,
          { method: "POST" },
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { detail?: string };
          toast.error(body.detail ?? "Couldn't reach your phone.");
          return;
        }
        toast.success(
          "Sent to your phone. Complete the checklist on the phone to confirm dispatch.",
        );
      } finally {
        setPushingDispatch(false);
      }
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
      broadcastCommit({ kind: "shipment-updated" });
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

  if (joinError) return <JoinErrorCard error={joinError} />;

  return (
    // pb-24 keeps the last card clear of the sticky action bar
    <div
      ref={cursorAnchorRef}
      onMouseMove={(e) => {
        const el = cursorAnchorRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        setCursor(
          (e.clientX - rect.left) / rect.width,
          (e.clientY - rect.top) / rect.height,
        );
      }}
      onMouseLeave={() => hideCursor()}
      className={cn(
        "relative space-y-4",
        !finalized && (canEdit || canPickup) && "pb-24",
      )}
    >
      <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden rounded-xl">
        {Object.values(cursors).map((c) => (
          <RemoteCursor
            key={c.peer.id}
            cursor={c}
            anchorWidth={anchorSize.w}
            anchorHeight={anchorSize.h}
          />
        ))}
      </div>

      <StatusBanner shipment={shipment} companyDefaults={companyDefaults} />

      {canEdit && !isCreator && creator && (
        <CreatorLockBanner creator={creator} />
      )}

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
            value={
              shipment.stock_lot?.item?.uuid ? (
                <Link
                  href={`/production/items/${shipment.stock_lot.item.uuid}`}
                  className="underline-offset-2 hover:underline"
                >
                  {shipment.stock_lot.item.name}
                </Link>
              ) : (
                shipment.stock_lot?.item?.name ?? "—"
              )
            }
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

      {/* -------- Dispatch dwell + carrying cost --------
           Only meaningful while the goods are still sitting in a
           dispatch cell. Once the truck has picked up (or the
           shipment was cancelled) the lot has left the cell and
           the running cost stops accruing — hide the banner so the
           operator doesn't misread it as an ongoing charge. */}
      {shipment.dispatch_dwell &&
        (shipment.status === "draft" || shipment.status === "ready") && (
        <DispatchDwellCard
          dwell={shipment.dispatch_dwell}
          companyDefaults={companyDefaults}
        />
      )}

      {/* -------- Ship-to & schedule card --------
           Where the goods are going, how many are going, and when
           we plan to send them. Locks at ``picked_up`` (BE gate). */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle className="text-sm">Ship-to &amp; schedule</CardTitle>
              <p className="text-xs text-muted-foreground">
                Recipient, delivery address, planned ship time, and
                quantity. Locks the moment the truck picks up — after
                that, only carrier paperwork stays editable.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canEdit && <CollabAvatars peers={presence} />}
              {shipToEditable && canEdit && (
                <>
                  {editingShipTo &&
                    canDrive &&
                    (shipment.customer || shipment.customer_order) && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={autofillFromCustomer}
                        title="Copy recipient + address + country from the customer profile."
                      >
                        <Sparkles className="mr-1 size-3.5" />
                        Fill from customer
                      </Button>
                    )}
                  {editingShipTo ? (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={discardShipTo}
                        disabled={savingShipTo}
                      >
                        <X className="mr-1 size-3.5" />
                        Discard
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={!dirtyShipTo || savingShipTo || !canDrive}
                        onClick={saveShipTo}
                        title={
                          !canDrive
                            ? `Only ${creator?.name ?? "the head of the room"} can save from this room.`
                            : undefined
                        }
                      >
                        {savingShipTo && (
                          <Loader2 className="mr-2 size-4 animate-spin" />
                        )}
                        Save
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setEditingShipTo(true)}
                      disabled={!canDrive}
                      title={
                        !canDrive
                          ? `Only ${creator?.name ?? "the head of the room"} can edit from this room.`
                          : undefined
                      }
                    >
                      <Pencil className="mr-1 size-3.5" />
                      Edit
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {editingShipTo ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Recipient" htmlFor="recipient_name">
                <div className="relative">
                  <Input
                    id="recipient_name"
                    value={state.recipient_name}
                    onChange={(e) =>
                      setField("recipient_name", e.target.value)
                    }
                    onFocus={() => focusField("recipient_name")}
                    onBlur={() => blurField("recipient_name")}
                    placeholder="e.g. Acme Ltd receiving desk"
                  />
                  <FieldEditingIndicator peer={fieldEditors.recipient_name} />
                </div>
              </Field>
              <Field label="Country" htmlFor="ship_to_country">
                <div className="relative">
                  <CountryPicker
                    id="ship_to_country"
                    value={state.ship_to_country}
                    onChange={(code) => setField("ship_to_country", code)}
                    onFocus={() => focusField("ship_to_country")}
                    onBlur={() => blurField("ship_to_country")}
                  />
                  <FieldEditingIndicator
                    peer={fieldEditors.ship_to_country}
                  />
                </div>
              </Field>
              <Field
                label="Delivery address"
                htmlFor="ship_to_address"
                className="sm:col-span-2"
              >
                <div className="relative">
                  <Textarea
                    id="ship_to_address"
                    value={state.ship_to_address}
                    onChange={(e) =>
                      setField("ship_to_address", e.target.value)
                    }
                    onFocus={() => focusField("ship_to_address")}
                    onBlur={() => blurField("ship_to_address")}
                    rows={3}
                    placeholder="Street, city, postcode"
                  />
                  <FieldEditingIndicator
                    peer={fieldEditors.ship_to_address}
                  />
                </div>
              </Field>
              <Field label="Planned ship time" htmlFor="planned_ship_at">
                <div className="relative">
                  <Input
                    id="planned_ship_at"
                    type="datetime-local"
                    value={state.planned_ship_at}
                    onChange={(e) =>
                      setField("planned_ship_at", e.target.value)
                    }
                    onFocus={() => focusField("planned_ship_at")}
                    onBlur={() => blurField("planned_ship_at")}
                  />
                  <FieldEditingIndicator peer={fieldEditors.planned_ship_at} />
                </div>
              </Field>
              <Field label="Qty" htmlFor="qty">
                <div className="relative">
                  <Input
                    id="qty"
                    type="number"
                    step="0.0001"
                    value={state.qty}
                    onChange={(e) => setField("qty", e.target.value)}
                    onFocus={() => focusField("qty")}
                    onBlur={() => blurField("qty")}
                    // Own-stock lots ship whole — the backend coerces
                    // qty back to the full dispatch-placement qty on
                    // save. Lock the input so the operator sees the
                    // constraint before they hit save (mirrors the
                    // server rule so there's no surprise). Bailee /
                    // 3PL lots stay editable — partial dispatches
                    // are legal there.
                    readOnly={shipment.stock_lot?.ownership_kind === "own"}
                    disabled={shipment.stock_lot?.ownership_kind === "own"}
                    aria-describedby={
                      shipment.stock_lot?.ownership_kind === "own"
                        ? "qty-locked-hint"
                        : undefined
                    }
                    className={cn(
                      shipment.stock_lot?.ownership_kind === "own" &&
                        "cursor-not-allowed bg-muted/50",
                    )}
                  />
                  <FieldEditingIndicator peer={fieldEditors.qty} />
                </div>
                {shipment.stock_lot?.ownership_kind === "own" && (
                  <p
                    id="qty-locked-hint"
                    className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground"
                  >
                    <Lock className="size-3" />
                    Ships in full — this lot isn&apos;t 3PL, so it can&apos;t be
                    split across multiple shipments.
                  </p>
                )}
              </Field>
              <Field
                label="Notes"
                htmlFor="notes"
                className="sm:col-span-2"
              >
                <div className="relative">
                  <Textarea
                    id="notes"
                    value={state.notes}
                    onChange={(e) => setField("notes", e.target.value)}
                    onFocus={() => focusField("notes")}
                    onBlur={() => blurField("notes")}
                    rows={2}
                    placeholder="Anything the truck arrival team should know."
                  />
                  <FieldEditingIndicator peer={fieldEditors.notes} />
                </div>
              </Field>
            </div>
          ) : (
            <DeliveryReadView
              shipment={shipment}
              companyDefaults={companyDefaults}
            />
          )}
        </CardContent>
      </Card>

      {/* -------- Carrier & vehicle card --------
           Delivery company, plate, driver, waybill, tracking, seal,
           temperature. Editable through ``picked_up`` (BE
           carrier-details endpoint). Pre-pickup needs shipments.edit;
           post-pickup needs shipments.pickup. */}
      <CarrierVehicleCard
        shipment={shipment}
        state={state}
        setField={setField}
        focusField={focusField}
        blurField={blurField}
        fieldEditors={fieldEditors}
        editable={carrierEditable}
        canEditByPerm={carrierPermHolder}
        canDrive={canDriveCarrier}
        editing={editingCarrier}
        setEditing={setEditingCarrier}
        dirty={dirtyCarrier}
        saving={savingCarrier}
        onSave={saveCarrier}
        onDiscard={discardCarrier}
        creatorName={creator?.name ?? null}
      />

      {/* -------- Pickup events — per-truck paperwork + evidence -------
           Renders the whole multi-visit timeline: one card per truck
           with its qty, checklist, photos, tracking number, seal,
           temperature, driver, plate, waybill, and delivery POD. The
           standalone "Truck-arrival evidence" card was retired here —
           it was designed for a one-shot shipment and duplicated the
           per-event data below, confusing the operator into thinking
           the checklist / photos / paperwork were shipment-wide.        */}
      <PickupEventsCard
        shipment={shipment}
        companyDefaults={companyDefaults}
        canEditPaperwork={canDriveCarrier}
      />

      {/* -------- Delivery confirmation -------- */}
      <DeliveryConfirmationCard
        shipment={shipment}
        companyDefaults={companyDefaults}
        canConfirmDelivery={canConfirmDelivery}
        onConfirmed={() => router.refresh()}
      />

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

      {/* -------- Sticky action bar --------
           Per-persona: canEdit = shipments.edit (Mark ready / Reopen /
           Cancel). canPickup = shipments.pickup (Truck arrived). Bar
           renders whenever the shipment is still open AND the viewer
           holds at least one relevant perm. */}
      {!finalized && (canEdit || canPickup) && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border/60 bg-background/95 shadow-lg backdrop-blur">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 px-4 py-3 sm:px-8">
            {shipment.status === "draft" && canEdit && (
              <div className="flex flex-col gap-1">
                <Button
                  variant="outline"
                  onClick={markReady}
                  // Only ship-to state blocks Mark Ready — carrier
                  // paperwork isn't required at this transition (BE
                  // ``validate_ready_prereqs`` only checks recipient
                  // / address / country / planned time / qty). Users
                  // can leave the Carrier card in edit mode without
                  // getting stuck on this button.
                  disabled={
                    busy ||
                    editingShipTo ||
                    dirtyShipTo ||
                    !canDrive ||
                    !readyReady
                  }
                  title={
                    !canDrive
                      ? `Only ${creator?.name ?? "the head of the room"} can drive paperwork state.`
                      : editingShipTo || dirtyShipTo
                        ? "Save your Ship-to & schedule edits first."
                        : !readyReady
                          ? `Fill in ${missingReadyFields.join(", ")} before marking Ready.`
                          : "Flip to Ready — recipient + address + country + planned ship time + qty all captured."
                  }
                >
                  <CheckCircle2 className="mr-1 size-4" />
                  Mark ready for pickup
                </Button>
                {/* Visible hint under the disabled button so
                    operators don't have to hover for the reason. */}
                {!readyReady && (
                  <p className="text-[11px] text-muted-foreground">
                    Missing: {missingReadyFields.join(", ")}
                  </p>
                )}
                {readyReady && (editingShipTo || dirtyShipTo) && (
                  <p className="text-[11px] text-muted-foreground">
                    Save your Ship-to &amp; schedule edits first.
                  </p>
                )}
                {readyReady && dirtyCarrier && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-300">
                    Note: unsaved Carrier &amp; vehicle edits will be
                    discarded on Mark Ready.
                  </p>
                )}
              </div>
            )}
            {shipment.status === "ready" && canEdit && (
              <Button
                variant="outline"
                onClick={markDraft}
                disabled={busy || !canDrive}
                title={
                  !canDrive
                    ? `Only ${creator?.name ?? "the head of the room"} can reopen for edits.`
                    : undefined
                }
              >
                Reopen for edits
              </Button>
            )}
            {shipment.status === "ready" && canPickup && (
              <Button
                onClick={pushDispatchToPhone}
                disabled={busy || pushingDispatch}
                title="The dispatch checklist opens on your paired phone — camera + on-the-dock workflow."
              >
                {pushingDispatch ? (
                  <Loader2 className="mr-1 size-4 animate-spin" />
                ) : (
                  <Truck className="mr-1 size-4" />
                )}
                Send dispatch form to my phone
              </Button>
            )}
            {canEdit &&
              (shipment.status === "draft" || shipment.status === "ready") &&
              (shipment.pickup_events?.length ?? 0) === 0 && (
                <Button
                  variant="ghost"
                  onClick={cancelShipment}
                  disabled={busy || !canDrive}
                  title={
                    !canDrive
                      ? `Only ${creator?.name ?? "the head of the room"} can cancel.`
                      : "Cancel this shipment (only available before any truck has arrived — once a pickup is logged the audit trail is frozen)."
                  }
                  className="ml-auto text-destructive hover:text-destructive"
                >
                  <XCircle className="mr-1 size-4" />
                  Cancel shipment
                </Button>
              )}
          </div>
        </div>
      )}

    </div>
  );
}

// ================================================================
// Collab helpers — local per HARD RULE pattern (mirrors warehouse-
// form + final-release-form). Each editable form re-declares its own
// so a copy stays close to the fields it protects.
// ================================================================

function CreatorLockBanner({
  creator,
}: {
  creator: { name?: string | null } | null;
}) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm">
      <Lock className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300" />
      <div>
        <p className="font-semibold text-amber-900 dark:text-amber-100">
          {creator?.name ?? "Another operator"} is driving this shipment
        </p>
        <p className="text-xs text-amber-800/90 dark:text-amber-200/90">
          You can watch + comment, but only the head of the room can
          save paperwork edits, mark ready, reopen, or cancel. The
          truck-arrival button stays available to any pickup-perm
          holder.
        </p>
      </div>
    </div>
  );
}

function JoinErrorCard({ error }: { error: JoinError }) {
  const cfg = {
    form_full: {
      Icon: AlertTriangle,
      title: "Room is full",
      detail: error.limit
        ? `Up to ${error.limit} people can edit this shipment at once. Wait for someone to leave, then refresh.`
        : "Wait for someone to leave, then refresh.",
    },
    forbidden: {
      Icon: LockKeyhole,
      title: "You can't edit here",
      detail:
        "Ask an admin for the `shipments.edit` permission to join this shipment's edit room.",
    },
    bad_topic: {
      Icon: AlertTriangle,
      title: "Unknown shipment",
      detail: "We couldn't find this shipment. The link may be malformed.",
    },
    unknown: {
      Icon: AlertTriangle,
      title: "Couldn't open the form",
      detail: "Something went wrong on our end. Please try again.",
    },
  }[error.reason];
  const { Icon } = cfg;
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-background">
          <Icon className="size-6" />
        </div>
        <p className="text-sm font-semibold">{cfg.title}</p>
        <p className="text-xs text-muted-foreground">{cfg.detail}</p>
        <Button asChild variant="outline" size="sm">
          <Link href="/shipments">Back to shipments</Link>
        </Button>
      </CardContent>
    </Card>
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
    badge: "muted" | "sky" | "emerald" | "amber" | "destructive";
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
  partially_picked: {
    title: "Partially picked up",
    body: (s) =>
      `${s.picked_up_qty} of ${s.qty} units on trucks so far. Waiting for the next visit.`,
    Icon: Truck,
    cls: "border-amber-500/40 bg-amber-500/5",
    badge: "amber",
  },
  picked_up: {
    title: "In transit",
    body: (s, cd) =>
      `Left the warehouse ${
        s.picked_up_at ? formatCompanyDate(s.picked_up_at, cd) : ""
      } via ${s.picked_up_by?.name ?? "—"}. Waiting for the POD to confirm delivery.`,
    Icon: Truck,
    cls: "border-amber-500/40 bg-amber-500/5",
    badge: "amber",
  },
  delivered: {
    title: "Delivered",
    body: (s, cd) =>
      `Received by ${s.recipient_signatory ?? "—"} on ${
        s.delivered_at ? formatCompanyDate(s.delivered_at, cd) : ""
      }. Confirmed by ${s.delivered_by?.name ?? "—"}. Record is immutable.`,
    Icon: PackageCheck,
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

/**
 * Read-mode of the Delivery card. Splits the paperwork into three
 * visual blocks the way the shipping coordinator actually reads it:
 *
 *   1. Ship-to slab — recipient / address / country stacked like a
 *      shipping label. The address is the star of the card, so it
 *      gets its own generous slab with the country underneath.
 *   2. Schedule row — planned ship time + qty, two compact tiles.
 *      Small numbers, no muted-heavy chrome.
 *   3. Notes — full width, only rendered when non-empty (an empty
 *      row was the loudest "nothing here" signal in the old grid).
 *
 * Uses company formatters for date + qty so the values match the
 * rest of PSP instead of the browser's US-defaults ``toLocaleString``.
 */
function DeliveryReadView({
  shipment,
  companyDefaults,
}: {
  shipment: Shipment;
  companyDefaults: CompanyDefaults | null;
}) {
  const country = shipment.ship_to_country
    ? countryLabel(shipment.ship_to_country)
    : null;
  const recipient = shipment.recipient_name?.trim();
  const address = shipment.ship_to_address?.trim();

  // Company-formatted date + explicit HH:mm — planned_ship_at is a
  // datetime, formatCompanyDate only renders the date half.
  let plannedLabel: string | null = null;
  if (shipment.planned_ship_at) {
    const d = new Date(shipment.planned_ship_at);
    if (!Number.isNaN(d.getTime())) {
      const time = `${String(d.getHours()).padStart(2, "0")}:${String(
        d.getMinutes(),
      ).padStart(2, "0")}`;
      plannedLabel = `${formatCompanyDate(shipment.planned_ship_at, companyDefaults)} · ${time}`;
    }
  }

  const qtyLabel = shipment.qty
    ? `${formatCompanyNumber(shipment.qty, companyDefaults)}${
        shipment.stock_lot?.unit_symbol
          ? ` ${shipment.stock_lot.unit_symbol}`
          : ""
      }`
    : null;

  const notes = shipment.notes?.trim();

  return (
    <div className="space-y-4">
      {/* -------- Ship-to slab (address is the hero) -------- */}
      <div className="rounded-lg border border-border/60 bg-muted/20 p-4">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Ship to
        </p>
        {recipient || address || country ? (
          <div className="mt-2 space-y-0.5 text-sm leading-relaxed">
            {recipient && (
              <p className="font-medium text-foreground">{recipient}</p>
            )}
            {address && (
              <p className="whitespace-pre-line text-foreground/85">
                {address}
              </p>
            )}
            {country && (
              <p className="text-foreground/85">{country}</p>
            )}
          </div>
        ) : (
          <p className="mt-2 text-sm italic text-muted-foreground">
            No recipient set yet — hit Edit to fill in the paperwork.
          </p>
        )}
      </div>

      {/* -------- Schedule row -------- */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border/60 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Planned ship time
          </p>
          <p
            className={cn(
              "mt-1 text-sm tabular-nums",
              !plannedLabel && "italic text-muted-foreground",
            )}
          >
            {plannedLabel ?? "Not set"}
          </p>
        </div>
        <div className="rounded-lg border border-border/60 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Quantity
          </p>
          <p
            className={cn(
              "mt-1 text-sm tabular-nums",
              !qtyLabel && "italic text-muted-foreground",
            )}
          >
            {qtyLabel ?? "Not set"}
          </p>
        </div>
      </div>

      {/* -------- Notes (only when present) -------- */}
      {notes && (
        <div className="rounded-lg border border-border/60 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Notes for the truck arrival team
          </p>
          <p className="mt-1 whitespace-pre-line text-sm text-foreground/85">
            {notes}
          </p>
        </div>
      )}
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

// Standalone TruckArrivalCard removed — it aggregated a single
// checklist / photo set across the shipment, which stopped making
// sense when multi-visit pickup landed. All per-truck evidence
// (checklist chips, photos, driver, plate, tracking, seal,
// temperature) now lives inside ``PickupEventsCard`` on each row.

/**
 * Carrier & vehicle paperwork — delivery company, plate, driver,
 * waybill, tracking, seal, temperature. Editable through
 * ``picked_up`` via the BE ``carrier-details`` endpoint (recipient /
 * address / qty are locked at pickup, but carrier paperwork
 * routinely needs corrections after departure — typo on the plate,
 * driver swap, tracking issued late by the carrier).
 *
 * Per-state perm gate mirrors BE ``ensure_carrier_perm``:
 * ``shipments.edit`` pre-pickup, ``shipments.pickup`` post-pickup.
 * Reuses the parent's useLiveForm state + head-of-room lock so
 * peer presence + cursors + field indicators all keep working.
 */
function CarrierVehicleCard({
  shipment,
  state,
  setField,
  focusField,
  blurField,
  fieldEditors,
  editable,
  canEditByPerm,
  canDrive,
  editing,
  setEditing,
  dirty,
  saving,
  onSave,
  onDiscard,
  creatorName,
}: {
  shipment: Shipment;
  state: FormState;
  setField: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  focusField: (name: string) => void;
  blurField: (name: string) => void;
  fieldEditors: Record<string, CollabPeer | null>;
  editable: boolean;
  canEditByPerm: boolean;
  canDrive: boolean;
  editing: boolean;
  setEditing: (v: boolean) => void;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  creatorName: string | null;
}) {
  const showEdit = editable && canEditByPerm;
  const anyEvents =
    (shipment.pickup_events?.length ?? 0) > 0 ||
    Number(shipment.picked_up_qty ?? 0) > 0;
  const postPickup =
    shipment.status === "picked_up" || shipment.status === "delivered";

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Truck className="size-4" />
              Carrier &amp; vehicle
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {anyEvents ? (
                <>
                  Shipment-wide defaults for the delivery company + a
                  fallback plate / driver / waybill for the paperwork. As
                  each truck arrives, the mobile dispatch form logs a
                  per-truck row on the <span className="font-semibold">Pickup progress</span> card
                  above — that's where you enter <span className="font-semibold">this truck's</span> tracking
                  number, seal, temperature. Edit them per row via
                  &quot;Edit paperwork&quot;.
                </>
              ) : postPickup ? (
                "The truck has left, but you can still amend delivery company, plate, driver, and waybill — anything the carrier finalises after departure. Per-truck tracking / seal / temperature live on the Pickup progress card above."
              ) : (
                "Delivery company, plate, driver, waybill. Fill what you know now; mobile dispatch captures the per-truck tracking / seal / temperature on arrival."
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {showEdit &&
              (editing ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={onDiscard}
                    disabled={saving}
                  >
                    <X className="mr-1 size-3.5" />
                    Discard
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!dirty || saving || !canDrive}
                    onClick={onSave}
                    title={
                      !canDrive
                        ? `Only ${creatorName ?? "the head of the room"} can save from this room.`
                        : undefined
                    }
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
                  disabled={!canDrive}
                  title={
                    !canDrive
                      ? `Only ${creatorName ?? "the head of the room"} can edit from this room.`
                      : undefined
                  }
                >
                  <Pencil className="mr-1 size-3.5" />
                  Edit
                </Button>
              ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {editing ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Delivery company" htmlFor="carrier">
              <div className="relative">
                <Input
                  id="carrier"
                  value={state.carrier}
                  onChange={(e) => setField("carrier", e.target.value)}
                  onFocus={() => focusField("carrier")}
                  onBlur={() => blurField("carrier")}
                  placeholder="e.g. DHL, DPD, own fleet"
                  maxLength={200}
                />
                <FieldEditingIndicator peer={fieldEditors.carrier} />
              </div>
            </Field>
            <Field label="Vehicle registration" htmlFor="vehicle_registration">
              <div className="relative">
                <Input
                  id="vehicle_registration"
                  value={state.vehicle_registration}
                  onChange={(e) =>
                    setField("vehicle_registration", e.target.value)
                  }
                  onFocus={() => focusField("vehicle_registration")}
                  onBlur={() => blurField("vehicle_registration")}
                  placeholder="e.g. AB12 CDE"
                  maxLength={40}
                  className="font-mono uppercase"
                />
                <FieldEditingIndicator
                  peer={fieldEditors.vehicle_registration}
                />
              </div>
            </Field>
            <Field label="Driver name" htmlFor="driver_name">
              <div className="relative">
                <Input
                  id="driver_name"
                  value={state.driver_name}
                  onChange={(e) => setField("driver_name", e.target.value)}
                  onFocus={() => focusField("driver_name")}
                  onBlur={() => blurField("driver_name")}
                  placeholder="e.g. Alex Baker"
                  maxLength={200}
                />
                <FieldEditingIndicator peer={fieldEditors.driver_name} />
              </div>
            </Field>
            <Field label="Waybill / CN ref" htmlFor="consignment_note_ref">
              <div className="relative">
                <Input
                  id="consignment_note_ref"
                  value={state.consignment_note_ref}
                  onChange={(e) =>
                    setField("consignment_note_ref", e.target.value)
                  }
                  onFocus={() => focusField("consignment_note_ref")}
                  onBlur={() => blurField("consignment_note_ref")}
                  placeholder="e.g. CN-92814"
                  maxLength={80}
                  className="font-mono"
                />
                <FieldEditingIndicator
                  peer={fieldEditors.consignment_note_ref}
                />
              </div>
            </Field>
            <Field label="Tracking number" htmlFor="tracking_number">
              <div className="relative">
                <Input
                  id="tracking_number"
                  value={state.tracking_number}
                  onChange={(e) =>
                    setField("tracking_number", e.target.value)
                  }
                  onFocus={() => focusField("tracking_number")}
                  onBlur={() => blurField("tracking_number")}
                  placeholder="e.g. 1Z999AA10123456784"
                  maxLength={120}
                  className="font-mono"
                />
                <FieldEditingIndicator peer={fieldEditors.tracking_number} />
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Carrier&apos;s parcel-tracking reference. Flows to the
                customer portal Dispatch card so they can self-serve
                the courier tracker.
              </p>
            </Field>
            <Field label="Seal number" htmlFor="seal_number">
              <div className="relative">
                <Input
                  id="seal_number"
                  value={state.seal_number}
                  onChange={(e) => setField("seal_number", e.target.value)}
                  onFocus={() => focusField("seal_number")}
                  onBlur={() => blurField("seal_number")}
                  placeholder="Container / trailer seal (if applicable)"
                  maxLength={60}
                  className="font-mono"
                />
                <FieldEditingIndicator peer={fieldEditors.seal_number} />
              </div>
            </Field>
            <Field
              label="Temperature (°C)"
              htmlFor="temperature_c"
              className="sm:col-span-2"
            >
              <div className="relative">
                <Input
                  id="temperature_c"
                  type="number"
                  step="0.1"
                  value={state.temperature_c}
                  onChange={(e) =>
                    setField("temperature_c", e.target.value)
                  }
                  onFocus={() => focusField("temperature_c")}
                  onBlur={() => blurField("temperature_c")}
                  placeholder="Cold-chain reading at loading (optional)"
                />
                <FieldEditingIndicator peer={fieldEditors.temperature_c} />
              </div>
            </Field>
          </div>
        ) : (
          <CarrierVehicleReadView shipment={shipment} />
        )}
      </CardContent>
    </Card>
  );
}

/** Read view for the carrier card. Same DetailRow grid the old
 *  Truck-arrival card used, but rendered as its own card body. */
function CarrierVehicleReadView({ shipment }: { shipment: Shipment }) {
  const temp = shipment.temperature_c
    ? `${shipment.temperature_c} °C`
    : "—";
  return (
    <div className="grid gap-3 text-sm sm:grid-cols-2">
      <DetailRow
        label="Delivery company"
        value={shipment.carrier ?? "—"}
      />
      <DetailRow
        label="Vehicle registration"
        value={shipment.vehicle_registration ?? "—"}
        mono
      />
      <DetailRow label="Driver name" value={shipment.driver_name ?? "—"} />
      <DetailRow
        label="Waybill / CN ref"
        value={shipment.consignment_note_ref ?? "—"}
        mono
      />
      <DetailRow
        label="Tracking number"
        value={shipment.tracking_number ?? "—"}
        mono
      />
      <DetailRow
        label="Seal number"
        value={shipment.seal_number ?? "—"}
        mono
      />
      <DetailRow label="Temperature" value={temp} />
    </div>
  );
}

function ChecklistLine({
  label,
  state,
}: {
  label: string;
  state: boolean | null;
}) {
  const tone =
    state === true
      ? "text-emerald-700 dark:text-emerald-300"
      : state === false
        ? "text-destructive"
        : "text-muted-foreground/70";
  const Icon = state === true ? CheckCircle2 : state === false ? XCircle : Circle;
  return (
    <li className={cn("flex items-center gap-2 text-xs", tone)}>
      <Icon className="size-3.5 shrink-0" />
      <span className={state === true ? "font-medium" : undefined}>{label}</span>
    </li>
  );
}

/** Compact per-event checklist chip. Green when the operator ticked
 *  it on mobile, muted grey otherwise. Read-only display — the values
 *  are frozen at pickup time by the mobile form. */
function ChecklistChip({
  label,
  state,
}: {
  label: string;
  state: boolean | null;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-medium tracking-wider uppercase",
        state === true
          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
          : "bg-muted text-muted-foreground/70",
      )}
    >
      {state === true ? (
        <CheckCircle2 className="size-2.5" />
      ) : (
        <Circle className="size-2.5" />
      )}
      {label}
    </span>
  );
}

function DeliveryConfirmationCard({
  shipment,
  companyDefaults,
  canConfirmDelivery,
  onConfirmed,
}: {
  shipment: Shipment;
  companyDefaults: CompanyDefaults | null;
  canConfirmDelivery: boolean;
  onConfirmed: () => void;
}) {
  const delivered = shipment.status === "delivered";
  const eligible = shipment.status === "picked_up";
  const files = shipment.delivery_files ?? [];

  // Hide the card entirely when it's not yet time to fill it — the
  // audit trail lives on the Timeline card. Show it once the truck
  // has left (so the customer-facing team can log the POD) OR once
  // it's been delivered (so anyone with view perm sees the sign-off).
  if (!eligible && !delivered) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <PackageCheck className="size-4" />
          Delivery confirmation
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {delivered
            ? "The consignment was received at destination. Recorded once when the POD came back."
            : "Log the POD once the receiver signs. Optional photos of the signed docket or damage sit next to the record."}
        </p>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {delivered ? (
          <DeliveryConfirmedView
            shipment={shipment}
            companyDefaults={companyDefaults}
            files={files}
          />
        ) : canConfirmDelivery ? (
          <DeliveryConfirmationForm
            shipment={shipment}
            onConfirmed={onConfirmed}
          />
        ) : (
          <p className="text-xs text-muted-foreground">
            You don&apos;t have the `shipments.confirm_delivery` permission —
            ask a coordinator with that role to log the POD.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function DeliveryConfirmedView({
  shipment,
  companyDefaults,
  files,
}: {
  shipment: Shipment;
  companyDefaults: CompanyDefaults | null;
  files: ShipmentDeliveryFile[];
}) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/[0.05] px-3 py-2 text-emerald-800 dark:text-emerald-200">
        <CheckCircle2 className="size-4" />
        <p className="text-xs">
          Confirmed by{" "}
          <span className="font-medium">
            {shipment.delivered_by?.name ?? "—"}
          </span>
          {" · "}
          {formatCompanyDate(shipment.delivered_at, companyDefaults)}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <DetailRow
          label="Received by (signatory)"
          value={shipment.recipient_signatory ?? "—"}
        />
        <DetailRow
          label="Received at"
          value={
            shipment.delivered_at
              ? formatCompanyDate(shipment.delivered_at, companyDefaults)
              : "—"
          }
        />
        {shipment.delivery_notes && (
          <div className="sm:col-span-2 space-y-1">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Notes
            </p>
            <p className="whitespace-pre-wrap text-sm">{shipment.delivery_notes}</p>
          </div>
        )}
      </div>
      {files.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Attachments
          </p>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {files.map((f) => (
              <li
                key={f.uuid}
                className="group relative overflow-hidden rounded-md border border-border/60 bg-muted/20"
              >
                <a
                  href={f.url}
                  target="_blank"
                  rel="noopener"
                  title={f.filename}
                >
                  {f.mime.startsWith("image/") ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={f.url}
                      alt={f.filename}
                      className="aspect-square w-full object-cover transition-opacity group-hover:opacity-90"
                    />
                  ) : (
                    <div className="flex aspect-square w-full flex-col items-center justify-center gap-1 bg-muted p-2 text-center">
                      <FileText className="size-6 text-muted-foreground" />
                      <p className="line-clamp-2 text-[10px] text-muted-foreground">
                        {f.filename}
                      </p>
                    </div>
                  )}
                </a>
                {f.uploaded_by && (
                  <p className="truncate bg-background/90 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {f.uploaded_by.name}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function DeliveryConfirmationForm({
  shipment,
  onConfirmed,
}: {
  shipment: Shipment;
  onConfirmed: () => void;
}) {
  const [signatory, setSignatory] = useState("");
  const [notes, setNotes] = useState("");
  const [receivedAt, setReceivedAt] = useState(() => {
    const d = new Date();
    // datetime-local wants "YYYY-MM-DDTHH:mm" in local time
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [files, setFiles] = useState<ShipmentDeliveryFile[]>(
    shipment.delivery_files ?? [],
  );
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function uploadOne(file: File): Promise<ShipmentDeliveryFile> {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(
      `/api/shipments/${encodeURIComponent(shipment.uuid)}/delivery-files`,
      { method: "POST", body: fd },
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        detail?: string;
        error?: string;
      };
      throw new Error(body.detail || body.error || `HTTP ${res.status}`);
    }
    const body = (await res.json()) as { file: ShipmentDeliveryFile };
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
      `/api/shipments/${encodeURIComponent(shipment.uuid)}/delivery-files/${encodeURIComponent(fileUuid)}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      setFiles(snapshot);
      toast.error("Couldn't remove the attachment.");
    }
  }

  const canSubmit = signatory.trim().length > 0 && !pending && !uploading;

  function onSubmit() {
    setSubmitError(null);
    startTransition(async () => {
      // datetime-local → ISO string. Treat the input as local time,
      // which is what the operator sees on their clock.
      const isoAt = new Date(receivedAt).toISOString();
      const res = await confirmShipmentDeliveryAction(shipment.uuid, {
        recipient_signatory: signatory.trim(),
        delivery_notes: notes.trim() || null,
        delivered_at: isoAt,
      });
      if (!res.ok) {
        setSubmitError(res.detail);
        return;
      }
      toast.success("Delivery confirmed.");
      onConfirmed();
    });
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="delivery-signatory">Received by (signatory)</Label>
          <Input
            id="delivery-signatory"
            value={signatory}
            onChange={(e) => setSignatory(e.target.value)}
            placeholder="Name from the delivery docket"
            className="h-10"
            autoComplete="off"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="delivery-at">Received at</Label>
          <Input
            id="delivery-at"
            type="datetime-local"
            value={receivedAt}
            onChange={(e) => setReceivedAt(e.target.value)}
            className="h-10"
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="delivery-notes">Notes (optional)</Label>
          <Textarea
            id="delivery-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. left with security, one pallet short, damaged corner…"
            className="min-h-[80px]"
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label>Attachments (optional)</Label>
          <span className="text-xs text-muted-foreground">
            {files.length} attached
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          POD scans, signed dockets, damage / condition photos. Images or PDF.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          className="sr-only"
          onChange={(e) => onFilesPicked(e.target.files)}
        />
        <Button
          type="button"
          variant="outline"
          className="w-full sm:w-auto"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? (
            <>
              <Loader2 className="mr-1.5 size-4 animate-spin" />
              Uploading…
            </>
          ) : (
            <>
              <Paperclip className="mr-1.5 size-4" />
              Attach files
            </>
          )}
        </Button>
        {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}
        {files.length > 0 && (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {files.map((f) => (
              <li
                key={f.uuid}
                className="group relative overflow-hidden rounded-md border border-border/60 bg-muted/20"
              >
                {f.mime.startsWith("image/") ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={f.url}
                    alt={f.filename}
                    className="aspect-square w-full object-cover"
                  />
                ) : (
                  <div className="flex aspect-square w-full flex-col items-center justify-center gap-1 bg-muted p-2 text-center">
                    <FileText className="size-6 text-muted-foreground" />
                    <p className="line-clamp-2 text-[10px] text-muted-foreground">
                      {f.filename}
                    </p>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => deleteFile(f.uuid)}
                  className="absolute right-1 top-1 rounded-full bg-background/90 p-1 text-destructive opacity-0 shadow ring-1 ring-border transition-opacity group-hover:opacity-100 focus:opacity-100"
                  aria-label="Remove"
                >
                  <X className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {submitError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/[0.03] p-3 text-sm text-destructive">
          {submitError}
        </div>
      )}

      <div className="flex justify-end">
        <Button type="button" onClick={onSubmit} disabled={!canSubmit}>
          {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
          <PackageCheck className="mr-1 size-4" />
          Confirm delivery
        </Button>
      </div>
    </>
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

// Compact dwell string ("2d 6h", "3h 12m", "45m", "just now") — mirrors
// how the rest of the app shows short elapsed periods.
function formatDwell(seconds: number): string {
  if (seconds < 60) return "just now";
  const totalMinutes = Math.floor(seconds / 60);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// Dispatch-dwell + carrying-cost card. Fed by the backend's
// `dispatch_dwell_summary` — appears only when the lot has actually
// landed in a dispatch cell. Amber tint after 3 days so a stalled
// pickup is visible at a glance.
function DispatchDwellCard({
  dwell,
  companyDefaults,
}: {
  dwell: NonNullable<Shipment["dispatch_dwell"]>;
  companyDefaults: CompanyDefaults | null;
}) {
  const stale = dwell.dwell_seconds > 3 * 24 * 60 * 60;
  const cost = dwell.estimated_storage_cost;
  const rate = dwell.rate_per_m3_per_day;

  return (
    <section
      className={cn(
        "flex flex-wrap items-start justify-between gap-3 rounded-md border px-4 py-3",
        stale
          ? "border-amber-500/40 bg-amber-500/[0.06]"
          : "border-border/60 bg-muted/20",
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "mt-0.5 grid size-8 place-items-center rounded-md",
            stale
              ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
              : "bg-background text-muted-foreground",
          )}
        >
          <Hourglass className="size-4" />
        </div>
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-medium">
            Sitting in dispatch since{" "}
            {formatCompanyDate(dwell.arrived_at, companyDefaults)} ·{" "}
            {formatDwell(dwell.dwell_seconds)}
          </p>
          <p className="text-xs text-muted-foreground">
            {cost && Number(cost) > 0 ? (
              <>
                Estimated storage cost so far:{" "}
                <span className="font-medium text-foreground">
                  {formatCompanyMoney(cost, companyDefaults)}
                </span>{" "}
                {rate && (
                  <>
                    at your 3PL rate ({formatCompanyMoney(rate, companyDefaults)}{" "}
                    / m³ / day × {dwell.volume_m3 ?? "0"} m³ ×{" "}
                    {Math.floor(dwell.dwell_seconds / 86400)}{" "}
                    {Math.floor(dwell.dwell_seconds / 86400) === 1
                      ? "day"
                      : "days"}
                    )
                  </>
                )}
              </>
            ) : rate ? (
              <>
                Storage cost accrues once a full day passes at your 3PL rate (
                {formatCompanyMoney(rate, companyDefaults)} / m³ / day). Volume
                on the floor: {dwell.volume_m3 ?? "0"} m³.
              </>
            ) : (
              <>
                Set a 3PL rate on the company settings page to see the estimated
                carrying cost while this shipment waits for pickup.
              </>
            )}
          </p>
        </div>
      </div>
    </section>
  );
}

// =============================================================================
// Pickup events — multi-visit truck arrivals
// =============================================================================

/**
 * Renders the shipment's pickup progress + timeline of events. Each
 * event is one truck arrival with its own qty, checklist, actor,
 * and photos. Offers a "Log another visit" button while remaining
 * qty > 0.
 *
 * Non-custom / single-visit shipments still work: one event with
 * qty = shipment.qty accumulates on the first pickup.
 */
function PickupEventsCard({
  shipment,
  companyDefaults,
  canEditPaperwork,
}: {
  shipment: Shipment;
  companyDefaults: CompanyDefaults | null;
  canEditPaperwork: boolean;
  onLogged?: () => void;
}) {
  const totalQty = Number(shipment.qty || 0);
  const pickedQty = Number(shipment.picked_up_qty || 0);
  const remainingQty = Number(shipment.remaining_qty || 0);
  const percent = totalQty > 0 ? Math.min(100, Math.round((pickedQty / totalQty) * 100)) : 0;
  const events = shipment.pickup_events ?? [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Truck className="size-4" />
              Pickup progress
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Each row is one truck visit — the checklist, load photos,
              driver, and paperwork all live per truck. Trucks arrive
              via the mobile dispatch form; use{" "}
              <span className="font-semibold">Edit paperwork</span> on any
              row to add a tracking number, seal, or temperature reading
              the carrier sends over after departure.
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {/* Progress bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">
              {pickedQty} of {totalQty} picked up
            </span>
            <span className="font-medium">{percent}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full transition-all",
                percent === 100
                  ? "bg-emerald-500"
                  : percent > 0
                    ? "bg-brand"
                    : "bg-muted-foreground/20",
              )}
              style={{ width: `${percent}%` }}
            />
          </div>
          {remainingQty > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Remaining {remainingQty} for the next truck.
            </p>
          )}
        </div>

        {/* Timeline of events */}
        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Timeline ({events.length})
          </p>
          {events.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No pickups logged yet. When the first truck arrives, log
              the event so the customer can see the progress.
            </p>
          ) : (
            <ul className="space-y-2">
              {events.map((e) => (
                <PickupEventRow
                  key={e.uuid}
                  event={e}
                  shipmentUuid={shipment.uuid}
                  companyDefaults={companyDefaults}
                  canEditPaperwork={canEditPaperwork}
                />
              ))}
            </ul>
          )}
        </div>

      </CardContent>
    </Card>
  );
}

function PickupEventRow({
  event,
  shipmentUuid,
  companyDefaults,
  canEditPaperwork,
}: {
  event: import("@/lib/shipments/types").ShipmentPickupEvent;
  shipmentUuid: string;
  companyDefaults: CompanyDefaults | null;
  canEditPaperwork: boolean;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [signatory, setSignatory] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const delivered = Boolean(event.delivered_at);

  // Paperwork edit — after the truck leaves, carriers frequently send
  // the tracking number over email. This lets the operator amend it
  // (plus seal / temperature / driver / plate corrections) without
  // touching qty / checklist / photos, all of which are frozen at
  // pickup time.
  const [paperworkOpen, setPaperworkOpen] = useState(false);
  const [pw, setPw] = useState({
    tracking_number: event.tracking_number ?? "",
    seal_number: event.seal_number ?? "",
    temperature_c: event.temperature_c ?? "",
    driver_name: event.driver_name ?? "",
    vehicle_registration: event.vehicle_registration ?? "",
    consignment_note_ref: event.consignment_note_ref ?? "",
    notes: event.notes ?? "",
  });
  const [pwSaving, startPwTransition] = useTransition();
  const [pwError, setPwError] = useState<string | null>(null);

  const savePaperwork = () => {
    setPwError(null);
    startPwTransition(async () => {
      const res = await updatePickupEventPaperworkAction(
        shipmentUuid,
        event.uuid,
        {
          tracking_number: pw.tracking_number.trim() || null,
          seal_number: pw.seal_number.trim() || null,
          temperature_c: pw.temperature_c.trim() || null,
          driver_name: pw.driver_name.trim() || null,
          vehicle_registration: pw.vehicle_registration.trim() || null,
          consignment_note_ref: pw.consignment_note_ref.trim() || null,
          notes: pw.notes.trim() || null,
        },
      );
      if (!res.ok) {
        setPwError(res.detail);
        return;
      }
      toast.success("Paperwork updated for this truck.");
      setPaperworkOpen(false);
    });
  };

  const submit = () => {
    if (!signatory.trim()) {
      setError("Enter who signed for the delivery.");
      return;
    }
    startTransition(async () => {
      const res = await confirmPickupEventDeliveryAction(
        shipmentUuid,
        event.uuid,
        {
          recipient_signatory: signatory.trim(),
          delivery_notes: notes.trim() || null,
        },
      );
      if (!res.ok) {
        setError(res.detail);
        return;
      }
      toast.success("Delivery confirmed.");
      setConfirmOpen(false);
      setSignatory("");
      setNotes("");
    });
  };

  return (
    <li className="rounded-md border border-border/60 bg-muted/10 px-3 py-2">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-mono font-semibold">{event.qty} units</span>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">
            {formatCompanyDate(event.picked_up_at, companyDefaults)}
          </span>
          {delivered ? (
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold tracking-widest text-emerald-700 uppercase">
              Received
            </span>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[10px]"
              onClick={() => setConfirmOpen((v) => !v)}
            >
              {confirmOpen ? "Cancel" : "Confirm receipt"}
            </Button>
          )}
        </div>
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        {event.picked_up_by?.name ?? "System"}
        {event.driver_name ? ` · Driver ${event.driver_name}` : ""}
        {event.vehicle_registration ? ` · Vehicle ${event.vehicle_registration}` : ""}
        {event.consignment_note_ref ? ` · CN ${event.consignment_note_ref}` : ""}
      </p>

      {/* Per-truck paperwork line. Renders the tracking / seal / temp
          the customer sees on the portal — nulls appear as em-dashes
          so it's obvious what still needs filling. */}
      <dl className="mt-1.5 grid grid-cols-1 gap-x-3 gap-y-0.5 text-[11px] sm:grid-cols-3">
        <div className="flex items-baseline gap-1.5">
          <dt className="text-muted-foreground">Tracking</dt>
          <dd className={cn("font-mono", !event.tracking_number && "text-muted-foreground/60")}>
            {event.tracking_number || "—"}
          </dd>
        </div>
        <div className="flex items-baseline gap-1.5">
          <dt className="text-muted-foreground">Seal</dt>
          <dd className={cn("font-mono", !event.seal_number && "text-muted-foreground/60")}>
            {event.seal_number || "—"}
          </dd>
        </div>
        <div className="flex items-baseline gap-1.5">
          <dt className="text-muted-foreground">Temp</dt>
          <dd
            className={cn(
              "font-mono",
              !event.temperature_c && "text-muted-foreground/60",
            )}
          >
            {event.temperature_c ? `${event.temperature_c} °C` : "—"}
          </dd>
        </div>
      </dl>

      {event.notes && (
        <p className="mt-1 text-[11px] italic text-muted-foreground">
          {event.notes}
        </p>
      )}

      {/* Per-truck checklist chips + edit-paperwork trigger. */}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
        <ChecklistChip label="Packaging" state={event.packaging_intact} />
        <ChecklistChip label="Labels" state={event.labels_verified} />
        <ChecklistChip label="Vehicle" state={event.vehicle_clean_suitable} />
        <ChecklistChip label="Transport" state={event.transport_condition_acceptable} />
        <ChecklistChip label="Approved" state={event.dispatch_approved} />
        {canEditPaperwork && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto h-6 px-2 text-[10px]"
            onClick={() => setPaperworkOpen((v) => !v)}
          >
            {paperworkOpen ? "Cancel" : "Edit paperwork"}
          </Button>
        )}
      </div>

      {paperworkOpen && canEditPaperwork && (
        <div className="mt-2 space-y-2 rounded-md border border-brand/40 bg-brand/[0.03] p-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Paperwork for this truck
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={`pw-track-${event.uuid}`} className="text-[10px]">
                Tracking number
              </Label>
              <Input
                id={`pw-track-${event.uuid}`}
                value={pw.tracking_number}
                onChange={(e) => setPw((s) => ({ ...s, tracking_number: e.target.value }))}
                placeholder="e.g. DHL-9F92-4402"
                className="h-8 text-xs font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`pw-seal-${event.uuid}`} className="text-[10px]">
                Seal number
              </Label>
              <Input
                id={`pw-seal-${event.uuid}`}
                value={pw.seal_number}
                onChange={(e) => setPw((s) => ({ ...s, seal_number: e.target.value }))}
                placeholder="e.g. SL-00214"
                className="h-8 text-xs font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`pw-temp-${event.uuid}`} className="text-[10px]">
                Temperature (°C)
              </Label>
              <Input
                id={`pw-temp-${event.uuid}`}
                type="number"
                step="0.1"
                min={-60}
                max={60}
                value={pw.temperature_c}
                onChange={(e) => setPw((s) => ({ ...s, temperature_c: e.target.value }))}
                className="h-8 text-xs font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`pw-cn-${event.uuid}`} className="text-[10px]">
                Consignment note
              </Label>
              <Input
                id={`pw-cn-${event.uuid}`}
                value={pw.consignment_note_ref}
                onChange={(e) => setPw((s) => ({ ...s, consignment_note_ref: e.target.value }))}
                className="h-8 text-xs font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`pw-drv-${event.uuid}`} className="text-[10px]">
                Driver
              </Label>
              <Input
                id={`pw-drv-${event.uuid}`}
                value={pw.driver_name}
                onChange={(e) => setPw((s) => ({ ...s, driver_name: e.target.value }))}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`pw-veh-${event.uuid}`} className="text-[10px]">
                Vehicle registration
              </Label>
              <Input
                id={`pw-veh-${event.uuid}`}
                value={pw.vehicle_registration}
                onChange={(e) =>
                  setPw((s) => ({ ...s, vehicle_registration: e.target.value.toUpperCase() }))
                }
                className="h-8 text-xs font-mono uppercase"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`pw-notes-${event.uuid}`} className="text-[10px]">
              Notes
            </Label>
            <Textarea
              id={`pw-notes-${event.uuid}`}
              rows={2}
              value={pw.notes}
              onChange={(e) => setPw((s) => ({ ...s, notes: e.target.value }))}
              className="text-xs"
            />
          </div>
          {pwError && <p className="text-[11px] text-destructive">{pwError}</p>}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setPaperworkOpen(false)}
              disabled={pwSaving}
              className="h-7 px-3 text-[11px]"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={savePaperwork}
              disabled={pwSaving}
              className="h-7 px-3 text-[11px]"
            >
              {pwSaving && <Loader2 className="mr-1 size-3 animate-spin" />}
              Save paperwork
            </Button>
          </div>
        </div>
      )}

      {delivered && (
        <p className="mt-1 text-[11px] text-emerald-700">
          Signed by <span className="font-medium">{event.recipient_signatory}</span> on{" "}
          {formatCompanyDate(event.delivered_at!, companyDefaults)}
          {event.delivery_notes ? ` · ${event.delivery_notes}` : ""}
        </p>
      )}

      {event.photos && event.photos.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {event.photos.map((p) => (
            <a
              key={p.uuid}
              href={p.url}
              target="_blank"
              rel="noopener"
              title={p.filename}
              className="size-12 overflow-hidden rounded-md border border-border/60"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.url}
                alt={p.filename}
                className="size-full object-cover"
              />
            </a>
          ))}
        </div>
      )}

      {confirmOpen && !delivered && (
        <div className="mt-2 space-y-2 rounded-md border border-border/60 bg-background p-2">
          <div className="space-y-1">
            <Label htmlFor={`sig-${event.uuid}`} className="text-[10px]">
              Recipient signatory
            </Label>
            <Input
              id={`sig-${event.uuid}`}
              value={signatory}
              onChange={(e) => setSignatory(e.target.value)}
              placeholder="Who signed for it?"
              className="h-8 text-xs"
              autoFocus
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`notes-${event.uuid}`} className="text-[10px]">
              Notes (optional)
            </Label>
            <Textarea
              id={`notes-${event.uuid}`}
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="text-xs"
            />
          </div>
          {error && <p className="text-[11px] text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              onClick={submit}
              disabled={pending}
              className="h-7 px-3 text-[11px]"
            >
              {pending && <Loader2 className="mr-1 size-3 animate-spin" />}
              Record delivery
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

