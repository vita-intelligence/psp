"use client";

/**
 * Lightweight new-CO form. Just enough to create the draft header
 * (customer + currency + default warehouse + ship date + notes); the
 * line editor + everything else happens on the detail page once the
 * CO has an id.
 */

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CurrencyPicker } from "@/components/forms/currency-picker";
import { FieldError } from "@/components/forms/field-error";
import { ErrorBanner } from "@/components/forms/error-banner";
import type {
  CompanyDefaults,
  CustomerSummary,
  Warehouse,
} from "@/lib/types";
import type { FieldErrors } from "@/lib/auth/actions";
import {
  createCustomerOrderAction,
  type CustomerOrderInput,
} from "@/lib/customer-orders/actions";
import type { ErrorResult } from "@/lib/errors/server";

interface Props {
  company: CompanyDefaults;
  customers: CustomerSummary[];
  warehouses: Warehouse[];
}

export function NewCustomerOrderForm({ company, customers, warehouses }: Props) {
  const router = useRouter();
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [currency, setCurrency] = useState(company.currency_code);
  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  const [shipDate, setShipDate] = useState("");
  const [customerRef, setCustomerRef] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [pending, startTransition] = useTransition();

  // When customer changes, snap currency to theirs unless the user
  // already overrode it.
  function onCustomerChange(idStr: string) {
    if (idStr === "none") {
      setCustomerId(null);
      return;
    }
    const id = Number(idStr);
    setCustomerId(id);
    const picked = customers.find((c) => c.id === id);
    if (picked) setCurrency(picked.currency_code);
  }

  // Filter to only effectively-approved customers — the BE will reject
  // submit otherwise, but blocking it here keeps the salesperson out
  // of an obvious dead-end.
  const eligibleCustomers = customers.filter(
    (c) => c.effective_approval_status === "approved",
  );

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setActionError(null);

    if (!customerId) {
      setErrors({ customer_id: ["Pick a customer."] });
      return;
    }

    const payload: CustomerOrderInput = {
      customer_id: customerId,
      currency_code: currency,
      default_warehouse_id: warehouseId,
      expected_ship_date: shipDate || null,
      customer_reference: customerRef.trim() || null,
      notes: notes.trim() || null,
    };

    startTransition(async () => {
      const res = await createCustomerOrderAction(payload);
      if (res.ok) {
        toast.success("Customer order created");
        router.push(`/sales/orders/${res.customer_order.uuid}`);
      } else {
        setErrors(res.fields ?? {});
        setActionError(res);
      }
    });
  }

  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle>Order details</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-4">
            <Label className="pt-2.5 text-sm font-medium">
              Customer <span className="text-destructive">*</span>
            </Label>
            <div className="space-y-1.5">
              <Select
                value={customerId !== null ? String(customerId) : "none"}
                onValueChange={onCustomerChange}
              >
                <SelectTrigger className="h-11">
                  <SelectValue placeholder="Pick a customer…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Pick —</SelectItem>
                  {eligibleCustomers.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name} · {c.currency_code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {eligibleCustomers.length === 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  No effectively-approved customers — approve a customer on
                  the Customers page before raising an order.
                </p>
              )}
              <FieldError messages={errors.customer_id} />
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-4">
            <Label className="pt-2.5 text-sm font-medium">Currency</Label>
            <div className="space-y-1.5">
              <CurrencyPicker
                value={currency}
                onChange={(v) => setCurrency(v ?? company.currency_code)}
              />
              <FieldError messages={errors.currency_code} />
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-4">
            <Label className="pt-2.5 text-sm font-medium">
              Default warehouse
            </Label>
            <div className="space-y-1.5">
              <Select
                value={warehouseId !== null ? String(warehouseId) : "none"}
                onValueChange={(v) =>
                  setWarehouseId(v === "none" ? null : Number(v))
                }
              >
                <SelectTrigger className="h-11">
                  <SelectValue placeholder="Pick a warehouse…" />
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
              <p className="text-[11px] text-muted-foreground">
                Required at submit time. Lines can override.
              </p>
              <FieldError messages={errors.default_warehouse_id} />
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-4">
            <Label htmlFor="ship_date" className="pt-2.5 text-sm font-medium">
              Expected ship date
            </Label>
            <Input
              id="ship_date"
              type="date"
              value={shipDate}
              onChange={(e) => setShipDate(e.target.value)}
              className="h-11"
            />
          </div>

          <div className="grid gap-2 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-4">
            <Label htmlFor="customer_ref" className="pt-2.5 text-sm font-medium">
              Customer reference
            </Label>
            <div className="space-y-1.5">
              <Input
                id="customer_ref"
                value={customerRef}
                onChange={(e) => setCustomerRef(e.target.value)}
                placeholder="Their PO number, if they sent one"
                className="h-11"
              />
              <FieldError messages={errors.customer_reference} />
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-4">
            <Label htmlFor="notes" className="pt-2.5 text-sm font-medium">
              Notes
            </Label>
            <Textarea
              id="notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {actionError && (
            <ErrorBanner
              detail={actionError.detail}
              code={actionError.code}
              debug={actionError.debug}
            />
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="submit" disabled={pending || !customerId}>
              {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Create draft
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
