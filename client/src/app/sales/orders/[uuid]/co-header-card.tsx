"use client";

/**
 * CO header card. Editable only in draft. After submit the header is
 * frozen — the workflow card is where action then happens.
 *
 * V1: simple inline form, no realtime collab. The form-channel
 * allowlist for "customer-order" is wired server-side so a future
 * follow-up can add CollabAvatars / FieldEditingIndicator / cursors
 * without backend changes.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, LockKeyhole } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorBanner } from "@/components/forms/error-banner";
import { FieldError } from "@/components/forms/field-error";
import type { CustomerOrder, Warehouse } from "@/lib/types";
import type { ErrorResult } from "@/lib/errors/server";
import type { FieldErrors } from "@/lib/auth/actions";
import {
  updateCustomerOrderAction,
  type CustomerOrderInput,
} from "@/lib/customer-orders/actions";

interface Props {
  co: CustomerOrder;
  canEdit: boolean;
  warehouses: Warehouse[];
  /** Injected by `<EditModeToggle>` so the wrapper flips back to view
   *  mode after a successful save. */
  onSavedSuccess?: () => void;
}

export function COHeaderCard({
  co,
  canEdit,
  warehouses,
  onSavedSuccess,
}: Props) {
  const router = useRouter();
  const [warehouseId, setWarehouseId] = useState<number | null>(
    co.default_warehouse_id,
  );
  const [shipDate, setShipDate] = useState(co.expected_ship_date ?? "");
  const [customerRef, setCustomerRef] = useState(co.customer_reference ?? "");
  const [deliveryAddress, setDeliveryAddress] = useState(
    co.delivery_address ?? "",
  );
  const [notes, setNotes] = useState(co.notes ?? "");
  const [discountPct, setDiscountPct] = useState(co.discount_pct ?? "0");
  const [taxRate, setTaxRate] = useState(co.tax_rate ?? "0");
  const [shippingFees, setShippingFees] = useState(co.shipping_fees ?? "0");
  const [additionalFees, setAdditionalFees] = useState(co.additional_fees ?? "0");
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [actionError, setActionError] = useState<ErrorResult | null>(null);

  function save() {
    setErrors({});
    setActionError(null);

    const payload: CustomerOrderInput = {
      default_warehouse_id: warehouseId,
      expected_ship_date: shipDate || null,
      customer_reference: customerRef.trim() || null,
      delivery_address: deliveryAddress.trim() || null,
      notes: notes.trim() || null,
      discount_pct: discountPct,
      tax_rate: taxRate,
      shipping_fees: shippingFees,
      additional_fees: additionalFees,
    };

    startTransition(async () => {
      const res = await updateCustomerOrderAction(co.uuid, payload);
      if (res.ok) {
        toast.success("Saved");
        onSavedSuccess?.();
        router.refresh();
      } else {
        setErrors(res.fields ?? {});
        setActionError(res);
      }
    });
  }

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="text-base">Order header</CardTitle>
            <CardDescription>
              Dates, warehouse, money rates. Locked once submitted.
            </CardDescription>
          </div>
          {!canEdit && (
            <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
              <LockKeyhole className="size-3" />
              Read-only
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <fieldset disabled={!canEdit || pending} className="contents">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Default warehouse">
              <Select
                value={warehouseId !== null ? String(warehouseId) : "none"}
                onValueChange={(v) =>
                  setWarehouseId(v === "none" ? null : Number(v))
                }
              >
                <SelectTrigger className="h-11">
                  <SelectValue placeholder="— None —" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— None —</SelectItem>
                  {warehouses.map((w) => (
                    <SelectItem key={w.id} value={String(w.id)}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError messages={errors.default_warehouse_id} />
            </Field>

            <Field label="Expected ship date">
              <Input
                type="date"
                value={shipDate}
                onChange={(e) => setShipDate(e.target.value)}
                className="h-11"
              />
            </Field>

            <Field label="Customer reference">
              <Input
                value={customerRef}
                onChange={(e) => setCustomerRef(e.target.value)}
                className="h-11"
              />
              <FieldError messages={errors.customer_reference} />
            </Field>

            <Field label="Currency">
              <Input
                value={co.currency_code}
                readOnly
                className="h-11 bg-muted/30 font-mono"
              />
              <p className="text-[11px] text-muted-foreground">
                Locked once the CO has lines.
              </p>
            </Field>

            <Field label="Discount %">
              <Input
                type="number"
                min={0}
                max={100}
                step="any"
                value={discountPct}
                onChange={(e) => setDiscountPct(e.target.value)}
                className="h-11 font-mono"
              />
              <FieldError messages={errors.discount_pct} />
            </Field>

            <Field label="Tax %">
              <Input
                type="number"
                min={0}
                max={100}
                step="any"
                value={taxRate}
                onChange={(e) => setTaxRate(e.target.value)}
                className="h-11 font-mono"
              />
              <FieldError messages={errors.tax_rate} />
            </Field>

            <Field label="Shipping">
              <Input
                type="number"
                min={0}
                step="any"
                value={shippingFees}
                onChange={(e) => setShippingFees(e.target.value)}
                className="h-11 font-mono"
              />
              <FieldError messages={errors.shipping_fees} />
            </Field>

            <Field label="Additional fees">
              <Input
                type="number"
                min={0}
                step="any"
                value={additionalFees}
                onChange={(e) => setAdditionalFees(e.target.value)}
                className="h-11 font-mono"
              />
              <FieldError messages={errors.additional_fees} />
            </Field>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-4">
            <Label className="pt-2.5 text-sm font-medium">Delivery address</Label>
            <Textarea
              value={deliveryAddress}
              onChange={(e) => setDeliveryAddress(e.target.value)}
              rows={2}
            />
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-4">
            <Label className="pt-2.5 text-sm font-medium">Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>

          {actionError && (
            <div className="mt-4">
              <ErrorBanner
                detail={actionError.detail}
                code={actionError.code}
                debug={actionError.debug}
              />
            </div>
          )}

          {canEdit && (
            <div className="mt-4 flex justify-end">
              <Button type="button" onClick={save} disabled={pending}>
                {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
                Save changes
              </Button>
            </div>
          )}
        </fieldset>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium">{label}</Label>
      {children}
    </div>
  );
}
