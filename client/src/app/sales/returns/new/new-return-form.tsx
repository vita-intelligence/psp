"use client";

/**
 * New-RMA form. Two paths:
 *   1. Pick a customer + a sent / partially-paid / paid invoice ⇒ RMA
 *      pre-linked to the invoice. Lines snap their unit_price from the
 *      invoice when added on the next screen.
 *   2. Pick a customer alone ⇒ standalone RMA (e.g. goodwill return
 *      with no source invoice yet). Lines need a manual unit_price.
 */

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import { FieldError } from "@/components/forms/field-error";
import { ErrorBanner } from "@/components/forms/error-banner";
import type { CustomerSummary } from "@/lib/types";
import type { FieldErrors } from "@/lib/auth/actions";
import { createCustomerReturnAction } from "@/lib/customer-returns/actions";
import type { ErrorResult } from "@/lib/errors/server";

interface Props {
  customers: CustomerSummary[];
}

interface InvoiceSummary {
  id: number;
  uuid: string;
  code: string | null;
  status: string;
  grand_total: string;
  currency_code: string;
}

async function fetchInvoicesForCustomer(
  customerId: number,
): Promise<InvoiceSummary[]> {
  // Returns can be raised against any sent / partially-paid / paid
  // invoice. Drafts and cancelled invoices aren't returnable. The list
  // endpoint doesn't filter by multi-status in V1, so we pull a healthy
  // page and trim client-side.
  const qs = new URLSearchParams({
    customer_id: String(customerId),
    limit: "50",
  });
  const res = await fetch(`/api/customer-invoices?${qs.toString()}`, {
    cache: "no-store",
  });
  if (!res.ok) return [];
  const body = (await res.json()) as {
    items: Array<InvoiceSummary & { status: string }>;
  };
  return body.items.filter((inv) =>
    ["sent", "partially_paid", "paid"].includes(inv.status),
  );
}

export function NewReturnForm({ customers }: Props) {
  const router = useRouter();
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [invoiceId, setInvoiceId] = useState<number | null>(null);
  const [availableInvoices, setAvailableInvoices] = useState<InvoiceSummary[]>(
    [],
  );
  const [returnDate, setReturnDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [reasonSummary, setReasonSummary] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [pending, startTransition] = useTransition();
  const lastCustomerId = useRef<number | null>(null);

  useEffect(() => {
    if (customerId === null) {
      setAvailableInvoices([]);
      setInvoiceId(null);
      return;
    }
    if (customerId === lastCustomerId.current) return;
    lastCustomerId.current = customerId;
    setInvoiceId(null);
    fetchInvoicesForCustomer(customerId).then(setAvailableInvoices);
  }, [customerId]);

  // Returns can be raised against any active customer (even suspended,
  // since you still owe them the credit) — we don't filter by approval
  // status the way invoices/COs do.
  const eligibleCustomers = customers;

  function onCustomerChange(idStr: string) {
    if (idStr === "none") {
      setCustomerId(null);
      return;
    }
    setCustomerId(Number(idStr));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setActionError(null);

    if (!customerId) {
      setErrors({ customer_id: ["Pick a customer."] });
      return;
    }

    const input = {
      customer_id: customerId,
      customer_invoice_id: invoiceId,
      return_date: returnDate,
      reason_summary: reasonSummary.trim() || null,
      notes: notes.trim() || null,
    };

    startTransition(async () => {
      const res = await createCustomerReturnAction(input);
      if (res.ok) {
        toast.success("Draft RMA created");
        router.push(`/sales/returns/${res.customer_return.uuid}`);
      } else {
        setErrors(res.fields ?? {});
        setActionError(res);
      }
    });
  }

  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle>RMA details</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <FormRow label="Customer *">
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
                No customers yet — create one first.
              </p>
            )}
            <FieldError messages={errors.customer_id} />
          </FormRow>

          {customerId !== null && (
            <FormRow label="Source invoice">
              <Select
                value={invoiceId !== null ? String(invoiceId) : "none"}
                onValueChange={(v) =>
                  setInvoiceId(v === "none" ? null : Number(v))
                }
                disabled={availableInvoices.length === 0}
              >
                <SelectTrigger className="h-11">
                  <SelectValue
                    placeholder={
                      availableInvoices.length === 0
                        ? "No issued invoices to return against"
                        : "Pick an invoice"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Standalone (no invoice) —</SelectItem>
                  {availableInvoices.map((inv) => (
                    <SelectItem key={inv.id} value={String(inv.id)}>
                      {inv.code ?? `#${inv.id}`} · {inv.grand_total}{" "}
                      {inv.currency_code} · {inv.status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Linking the invoice lets us snap unit prices when adding
                lines, and auto-issues a credit note on accept.
              </p>
            </FormRow>
          )}

          <FormRow label="Return date *">
            <Input
              type="date"
              value={returnDate}
              onChange={(e) => setReturnDate(e.target.value)}
              className="h-11"
            />
            <FieldError messages={errors.return_date} />
          </FormRow>

          <FormRow label="Reason summary">
            <Input
              value={reasonSummary}
              onChange={(e) => setReasonSummary(e.target.value)}
              placeholder="One-line headline, e.g. 'damaged on delivery'"
              className="h-11"
            />
            <p className="text-[11px] text-muted-foreground">
              Per-line reasons (damaged / wrong item / quality fail / etc.)
              are picked when adding lines on the next screen.
            </p>
          </FormRow>

          <FormRow label="Notes">
            <Textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </FormRow>

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
              Create draft RMA
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function FormRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-4">
      <Label className="pt-2.5 text-sm font-medium">{label}</Label>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}
