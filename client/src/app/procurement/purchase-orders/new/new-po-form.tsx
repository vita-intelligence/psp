"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2, Lock, LockKeyhole, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorBanner } from "@/components/forms/error-banner";
import { CurrencyPicker } from "@/components/forms/currency-picker";
import {
  DerivedDateField,
  addDaysFromToday,
} from "@/components/forms/derived-date-field";
import { CollabAvatars } from "@/components/realtime/collab-avatars";
import { FieldEditingIndicator } from "@/components/realtime/field-editing-indicator";
import { RemoteCursor } from "@/components/realtime/remote-cursor";
import { useLiveForm } from "@/lib/realtime/use-live-form";
import { useFormPresenceBeacon } from "@/lib/realtime/use-form-presence-beacon";
import { cn } from "@/lib/utils";
import type { VendorSummary } from "@/lib/types";
import type { ErrorDebug } from "@/lib/errors/types";
import { createPOAction } from "@/lib/purchase-orders/actions";

interface Props {
  vendors: VendorSummary[];
}

interface FormState {
  vendorId: string;
  currency: string;
  deliveryDate: string;
  deliveryAddress: string;
}

const INITIAL: FormState = {
  vendorId: "",
  currency: "GBP",
  deliveryDate: "",
  deliveryAddress: "",
};

export function NewPOForm({ vendors }: Props) {
  const router = useRouter();
  const resource = "purchase-order:new";
  useFormPresenceBeacon(resource);

  type CommitPayload = { kind: "created"; uuid: string };

  const {
    state,
    setField,
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
    resource,
    initialState: INITIAL,
    onCommit: (raw) => {
      const msg = raw as CommitPayload | null;
      if (!msg) return;
      router.push(`/procurement/purchase-orders/${msg.uuid}`);
    },
  });

  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<{
    detail: string;
    code?: string;
    debug?: ErrorDebug;
  } | null>(null);

  const approvedVendors = useMemo(
    () =>
      vendors.filter(
        (v) => v.approval_status === "approved" && v.is_active,
      ),
    [vendors],
  );
  const selectedVendor = approvedVendors.find(
    (v) => String(v.id) === state.vendorId,
  );

  function onPickVendor(id: string) {
    setField("vendorId", id);
    const v = approvedVendors.find((x) => String(x.id) === id);
    if (v) setField("currency", v.currency_code);
  }

  function onSubmit() {
    if (!state.vendorId || !isCreator) return;
    setError(null);
    startTransition(async () => {
      const res = await createPOAction({
        vendor_id: Number(state.vendorId),
        currency_code: state.currency,
        expected_delivery_date: state.deliveryDate || null,
        delivery_address: state.deliveryAddress.trim() || null,
      });
      if (res.ok) {
        broadcastCommit({ kind: "created", uuid: res.po.uuid });
        router.push(`/procurement/purchase-orders/${res.po.uuid}`);
      } else {
        setError({ detail: res.detail, code: res.code, debug: res.debug });
      }
    });
  }

  const cursorAnchorRef = useRef<HTMLDivElement | null>(null);
  const [anchorSize, setAnchorSize] = useState<{ w: number; h: number }>({
    w: 0,
    h: 0,
  });
  useEffect(() => {
    const el = cursorAnchorRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setAnchorSize({ w: rect.width, h: rect.height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => hideCursor(), [hideCursor]);

  const onCursorMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = cursorAnchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      setCursor(x, y);
    },
    [setCursor],
  );

  if (joinError) {
    return <JoinErrorCard error={joinError} />;
  }

  return (
    <section
      ref={cursorAnchorRef}
      onMouseMove={onCursorMove}
      onMouseLeave={hideCursor}
      className="relative space-y-4 rounded-lg border border-border/60 bg-card p-5 shadow-sm"
    >
      <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden rounded-lg">
        {Object.entries(cursors).map(([id, cursor]) => (
          <RemoteCursor
            key={id}
            cursor={cursor}
            anchorWidth={anchorSize.w}
            anchorHeight={anchorSize.h}
          />
        ))}
      </div>

      <header className="flex items-center justify-end">
        <CollabAvatars peers={presence} />
      </header>

      {error && (
        <ErrorBanner
          detail={error.detail}
          code={error.code}
          debug={error.debug}
        />
      )}

      <div className="space-y-1.5">
        <Label
          htmlFor="vendorId"
          className="text-[11px] uppercase tracking-wider text-muted-foreground"
        >
          Vendor
        </Label>
        <div className="relative">
          <Select value={state.vendorId} onValueChange={onPickVendor}>
            <SelectTrigger
              id="vendorId"
              className="h-10"
              onFocus={() => focusField("vendorId")}
              onBlur={() => blurField("vendorId")}
            >
              <SelectValue placeholder="Pick an approved vendor…" />
            </SelectTrigger>
            <SelectContent>
              {approvedVendors.length === 0 ? (
                <SelectItem value="__empty__" disabled>
                  No approved vendors. Approve one first.
                </SelectItem>
              ) : (
                approvedVendors.map((v) => (
                  <SelectItem key={v.id} value={String(v.id)}>
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {v.code ?? `#${v.id}`}
                      </span>
                      <span>{v.name}</span>
                    </span>
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          <FieldEditingIndicator peer={fieldEditors.vendorId} />
        </div>
        {selectedVendor && (
          <p className="text-[11px] text-muted-foreground">
            Default lead time: {selectedVendor.default_lead_time_days} days ·
            currency {selectedVendor.currency_code}
          </p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label
            htmlFor="currency"
            className="text-[11px] uppercase tracking-wider text-muted-foreground"
          >
            Currency
          </Label>
          <div className="relative">
            <CurrencyPicker
              id="currency"
              value={state.currency}
              onChange={(v) => setField("currency", v ?? "GBP")}
              onFocus={() => focusField("currency")}
              onBlur={() => blurField("currency")}
            />
            <FieldEditingIndicator peer={fieldEditors.currency} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label
            htmlFor="deliveryDate"
            className="text-[11px] uppercase tracking-wider text-muted-foreground"
          >
            Expected delivery
          </Label>
          <div className="relative">
            <DerivedDateField
              id="deliveryDate"
              computed={
                selectedVendor
                  ? addDaysFromToday(selectedVendor.default_lead_time_days)
                  : ""
              }
              value={state.deliveryDate}
              onChange={(v) => setField("deliveryDate", v)}
              onFocus={() => focusField("deliveryDate")}
              onBlur={() => blurField("deliveryDate")}
              derivationHint={
                selectedVendor
                  ? `Today + ${selectedVendor.default_lead_time_days}d lead time`
                  : "Pick a vendor"
              }
              reasonComputedMissing="Pick an approved vendor above to compute."
            />
            <FieldEditingIndicator peer={fieldEditors.deliveryDate} />
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label
          htmlFor="deliveryAddress"
          className="text-[11px] uppercase tracking-wider text-muted-foreground"
        >
          Delivery address
        </Label>
        <div className="relative">
          <Textarea
            id="deliveryAddress"
            rows={2}
            value={state.deliveryAddress}
            onChange={(e) => setField("deliveryAddress", e.target.value)}
            onFocus={() => focusField("deliveryAddress")}
            onBlur={() => blurField("deliveryAddress")}
          />
          <FieldEditingIndicator peer={fieldEditors.deliveryAddress} />
        </div>
      </div>

      {/*
       * The old "Notes" textarea is gone — once the PO is created, the
       * discussion happens in the polymorphic Comments thread on the
       * detail page (timestamped, attributable, audit-trailed). The
       * `purchase_orders.notes` DB column is left intact so historic
       * data isn't lost.
       */}

      {!isCreator && creator && (
        <div className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
          <Lock className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Only{" "}
            <span className="font-medium text-foreground">{creator.name}</span>{" "}
            can create from this room. Your edits sync to them live.
          </span>
        </div>
      )}

      <div className="flex justify-end">
        <Button
          onClick={onSubmit}
          disabled={pending || !state.vendorId || !isCreator}
          title={
            isCreator
              ? undefined
              : creator
                ? `Only ${creator.name} can create from this room.`
                : undefined
          }
        >
          {pending ? (
            <Loader2 className="mr-1.5 size-4 animate-spin" />
          ) : (
            <Save className="mr-1.5 size-4" />
          )}
          Create draft PO
        </Button>
      </div>
    </section>
  );
}

function JoinErrorCard({
  error,
}: {
  error: import("@/lib/realtime/use-live-form").JoinError;
}) {
  const config = {
    form_full: {
      icon: AlertCircle,
      tone: "amber" as const,
      title: "Form is at capacity",
      detail: error.limit
        ? `Up to ${error.limit} people can draft this PO at once.`
        : "Wait for someone to leave, then refresh.",
    },
    forbidden: {
      icon: LockKeyhole,
      tone: "muted" as const,
      title: "You can't draft a PO here",
      detail: "Ask an admin for the `procurement.po_create` permission.",
    },
    bad_topic: {
      icon: AlertCircle,
      tone: "destructive" as const,
      title: "Unknown form",
      detail: "Reload the page.",
    },
    unknown: {
      icon: AlertCircle,
      tone: "destructive" as const,
      title: "Couldn't open the form",
      detail: "Something went wrong on our end.",
    },
  }[error.reason];

  const Icon = config.icon;
  const toneClass =
    config.tone === "amber"
      ? "border-amber-500/30 bg-amber-50/40 dark:bg-amber-950/20"
      : config.tone === "destructive"
        ? "border-destructive/30 bg-destructive/[0.03]"
        : "border-border/60 bg-muted/30";
  const iconClass =
    config.tone === "amber"
      ? "text-amber-600 dark:text-amber-400"
      : config.tone === "destructive"
        ? "text-destructive"
        : "text-muted-foreground";

  return (
    <Card className={cn("border", toneClass)}>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-background">
          <Icon className={cn("size-6", iconClass)} />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-semibold">{config.title}</p>
          <p className="text-xs text-muted-foreground">{config.detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}
