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
import type { JoinError } from "@/lib/realtime/use-live-form";
import { formatCompanyDate, formatCompanyMoney } from "@/lib/format/company";
import { findCountry } from "@/lib/iso/countries";
import { cn } from "@/lib/utils";
import {
  cancelShipmentAction,
  confirmShipmentDeliveryAction,
  markShipmentDraftAction,
  markShipmentReadyAction,
  updateShipmentAction,
} from "@/lib/shipments/actions";
import type { ErrorResult } from "@/lib/errors/server";
import type {
  Shipment,
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
  canPickup,
  canConfirmDelivery,
}: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<ErrorResult | null>(null);
  const [saving, startSave] = useTransition();
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

  // Reset live-form state + close edit mode whenever the server
  // payload changes (e.g. after Mark ready refreshes the row).
  useEffect(() => {
    resetState(initialFrom(shipment));
    setEditing(false);
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

  const editable = shipment.status === "draft" || shipment.status === "ready";
  // Terminal states — action bar hides everything except the trailing
  // Cancel button. `picked_up` used to be terminal here, but now that
  // delivery is a real event the desktop team logs, we keep the bar
  // open through `picked_up` (Confirm delivery lives inside a dedicated
  // card, not the sticky bar) and only close it on delivered/cancelled.
  const finalized =
    shipment.status === "delivered" || shipment.status === "cancelled";

  const original = useMemo(() => initialFrom(shipment), [shipment]);
  const dirty = JSON.stringify(state) !== JSON.stringify(original);
  // Head-of-room lock. Non-heads can join + watch, but only the
  // creator (first joiner) can Save / Mark ready / Reopen / Cancel.
  // Pickup is a separate physical event — gated on canPickup, not
  // isCreator, since whoever's at the desk when the truck rolls in
  // hits the button.
  const canDrive = canEdit && isCreator;

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
    if (!c) return;
    // Auto-fill the empty fields only — never stomp a manual override.
    if (!state.recipient_name) setField("recipient_name", c.name);
    if (!state.ship_to_address && c.legal_address) {
      setField("ship_to_address", c.legal_address);
    }
    if (!state.ship_to_country && c.country_code) {
      setField("ship_to_country", c.country_code);
    }
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
      // Nudge peers to refetch through the collab channel before we
      // refresh ourselves.
      broadcastCommit({ kind: "shipment-updated" });
      router.refresh();
    });
  };

  const discard = () => {
    resetState(original);
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
            <div className="flex flex-wrap items-center gap-2">
              {canEdit && <CollabAvatars peers={presence} />}
              {editable && canEdit && (
                <>
                  {editing && shipment.customer && canDrive && (
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
                        disabled={!dirty || saving || !canDrive}
                        onClick={save}
                        title={
                          !canDrive
                            ? `Only ${creator?.name ?? "the head of the room"} can save from this room.`
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
          {editing ? (
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

      {/* -------- Truck arrival — reflects the mobile dispatch form -------- */}
      <TruckArrivalCard
        shipment={shipment}
        companyDefaults={companyDefaults}
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
              <Button
                variant="outline"
                onClick={markReady}
                disabled={
                  busy || editing || dirty || !canDrive || !readyReady
                }
                title={
                  !canDrive
                    ? `Only ${creator?.name ?? "the head of the room"} can drive paperwork state.`
                    : editing || dirty
                      ? "Save your edits first."
                      : !readyReady
                        ? `Fill in ${missingReadyFields.join(", ")} before marking Ready.`
                        : "Flip to Ready — recipient + address + country + planned ship time + qty all captured."
                }
              >
                <CheckCircle2 className="mr-1 size-4" />
                Mark ready for pickup
              </Button>
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
            {canEdit && (
              <Button
                variant="ghost"
                onClick={cancelShipment}
                disabled={busy || !canDrive}
                title={
                  !canDrive
                    ? `Only ${creator?.name ?? "the head of the room"} can cancel.`
                    : undefined
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

interface ChecklistDisplayItem {
  key:
    | "packaging_intact"
    | "labels_verified"
    | "vehicle_clean_suitable"
    | "transport_condition_acceptable"
    | "dispatch_approved";
  label: string;
}

const TRUCK_ARRIVAL_CHECKLIST: ChecklistDisplayItem[] = [
  { key: "packaging_intact", label: "Packaging intact" },
  { key: "labels_verified", label: "Correct labels verified" },
  { key: "vehicle_clean_suitable", label: "Vehicle clean & suitable" },
  {
    key: "transport_condition_acceptable",
    label: "Transport condition acceptable",
  },
  { key: "dispatch_approved", label: "Dispatch approved" },
];

function TruckArrivalCard({
  shipment,
  companyDefaults,
}: {
  shipment: Shipment;
  companyDefaults: CompanyDefaults | null;
}) {
  const submitted = shipment.status === "picked_up" && !!shipment.picked_up_at;
  const files = shipment.pickup_files ?? [];
  const anyChecklistCaptured = TRUCK_ARRIVAL_CHECKLIST.some(
    (item) => shipment[item.key] !== null,
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Truck className="size-4" />
          Truck arrival
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {submitted
            ? "Signed off from the mobile dispatch form when the truck arrived."
            : "Nothing captured yet — the dispatch checklist runs on the operator's phone when the truck arrives."}
        </p>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {submitted && shipment.picked_up_by && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/[0.05] px-3 py-2 text-emerald-800 dark:text-emerald-200">
            <CheckCircle2 className="size-4" />
            <p className="text-xs">
              Signed off by{" "}
              <span className="font-medium">
                {shipment.picked_up_by.name}
              </span>
              {" · "}
              {formatCompanyDate(shipment.picked_up_at, companyDefaults)}
            </p>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <DetailRow label="Delivery company" value={shipment.carrier ?? "—"} />
          <DetailRow
            label="Vehicle registration"
            value={shipment.vehicle_registration ?? "—"}
            mono
          />
        </div>

        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Checklist
          </p>
          {anyChecklistCaptured ? (
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {TRUCK_ARRIVAL_CHECKLIST.map((item) => (
                <ChecklistLine
                  key={item.key}
                  label={item.label}
                  state={shipment[item.key]}
                />
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              No sign-offs recorded yet.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Photos of the load
            </p>
            <span className="text-[11px] text-muted-foreground">
              {files.length} attached
            </span>
          </div>
          {files.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No photos captured yet.
            </p>
          ) : (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {files.map((f) => (
                <li
                  key={f.uuid}
                  className="group relative overflow-hidden rounded-md border border-border/60 bg-muted/20"
                >
                  <a href={f.url} target="_blank" rel="noopener" title={f.filename}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={f.url}
                      alt={f.filename}
                      className="aspect-square w-full object-cover transition-opacity group-hover:opacity-90"
                    />
                  </a>
                  {f.uploaded_by && (
                    <p className="truncate bg-background/90 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {f.uploaded_by.name}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
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
