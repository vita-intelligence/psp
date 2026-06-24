"use client";

/**
 * Invoice header card. Editable in draft only. Mirrors the CO header
 * pattern — EditModeToggle wraps it on the page, so canEdit comes in
 * as `canEdit && isDraft && isEditing`.
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
import { ErrorBanner } from "@/components/forms/error-banner";
import { FieldError } from "@/components/forms/field-error";
import type { CustomerInvoice } from "@/lib/types";
import type { ErrorResult } from "@/lib/errors/server";
import type { FieldErrors } from "@/lib/auth/actions";
import {
  updateCustomerInvoiceAction,
  type CustomerInvoiceInput,
} from "@/lib/customer-invoices/actions";

interface Props {
  invoice: CustomerInvoice;
  canEdit: boolean;
  onSavedSuccess?: () => void;
}

export function InvoiceHeaderCard({ invoice, canEdit, onSavedSuccess }: Props) {
  const router = useRouter();
  const [invoiceDate, setInvoiceDate] = useState(invoice.invoice_date);
  const [dueDate, setDueDate] = useState(invoice.due_date ?? "");
  const [customerRef, setCustomerRef] = useState(invoice.customer_reference ?? "");
  const [billingAddress, setBillingAddress] = useState(
    invoice.billing_address ?? "",
  );
  const [freeText, setFreeText] = useState(invoice.free_text ?? "");
  const [discountPct, setDiscountPct] = useState(invoice.discount_pct ?? "0");
  const [taxRate, setTaxRate] = useState(invoice.tax_rate ?? "0");
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [actionError, setActionError] = useState<ErrorResult | null>(null);

  function save() {
    setErrors({});
    setActionError(null);

    const payload: CustomerInvoiceInput = {
      invoice_date: invoiceDate,
      due_date: dueDate || null,
      customer_reference: customerRef.trim() || null,
      billing_address: billingAddress.trim() || null,
      free_text: freeText.trim() || null,
      discount_pct: discountPct,
      tax_rate: taxRate,
    };

    startTransition(async () => {
      const res = await updateCustomerInvoiceAction(invoice.uuid, payload);
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
            <CardTitle className="text-base">Invoice header</CardTitle>
            <CardDescription>
              Dates, billing address, money rates. Locked once sent.
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
            <Field label="Invoice date">
              <Input
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                className="h-11"
              />
              <FieldError messages={errors.invoice_date} />
            </Field>

            <Field label="Due date">
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="h-11"
              />
              <FieldError messages={errors.due_date} />
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
                value={invoice.currency_code}
                readOnly
                className="h-11 bg-muted/30 font-mono"
              />
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
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-4">
            <Label className="pt-2.5 text-sm font-medium">Billing address</Label>
            <Textarea
              rows={3}
              value={billingAddress}
              onChange={(e) => setBillingAddress(e.target.value)}
            />
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-4">
            <Label className="pt-2.5 text-sm font-medium">Free text</Label>
            <Textarea
              rows={3}
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
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
