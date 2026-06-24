"use client";

/**
 * New-invoice form. Two paths:
 *   1. Pick a customer + a confirmed CO ⇒ generate-from-CO, lines
 *      auto-pulled at unbilled qty.
 *   2. Pick a customer alone ⇒ blank draft, user adds lines on the
 *      detail page.
 *
 * The CO selector is filtered to confirmed COs for the picked
 * customer, fetched from the customer-orders proxy.
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
import { CurrencyPicker } from "@/components/forms/currency-picker";
import { FieldError } from "@/components/forms/field-error";
import { ErrorBanner } from "@/components/forms/error-banner";
import type { CompanyDefaults, CustomerSummary } from "@/lib/types";
import type { FieldErrors } from "@/lib/auth/actions";
import {
  createCustomerInvoiceAction,
  createInvoiceFromCOAction,
} from "@/lib/customer-invoices/actions";
import type { ErrorResult } from "@/lib/errors/server";

interface Props {
  company: CompanyDefaults;
  customers: CustomerSummary[];
}

interface COSummary {
  id: number;
  uuid: string;
  code: string | null;
  status: string;
  grand_total: string;
  currency_code: string;
}

async function fetchConfirmedCOsForCustomer(customerId: number): Promise<COSummary[]> {
  const qs = new URLSearchParams({
    customer_id: String(customerId),
    status: "confirmed",
    limit: "50",
  });
  const res = await fetch(`/api/customer-orders?${qs.toString()}`, {
    cache: "no-store",
  });
  if (!res.ok) return [];
  const body = (await res.json()) as {
    items: Array<{
      id: number;
      uuid: string;
      code: string | null;
      status: string;
      grand_total: string;
      currency_code: string;
    }>;
  };
  return body.items;
}

export function NewInvoiceForm({ company, customers }: Props) {
  const router = useRouter();
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [coUuid, setCoUuid] = useState<string | null>(null);
  const [availableCos, setAvailableCos] = useState<COSummary[]>([]);
  const [currency, setCurrency] = useState(company.currency_code);
  const [invoiceDate, setInvoiceDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [dueDate, setDueDate] = useState("");
  const [customerRef, setCustomerRef] = useState("");
  const [freeText, setFreeText] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [pending, startTransition] = useTransition();
  const lastCustomerId = useRef<number | null>(null);

  // When customer changes, fetch their confirmed COs + snap currency +
  // default due date from payment terms.
  useEffect(() => {
    if (customerId === null) {
      setAvailableCos([]);
      setCoUuid(null);
      return;
    }
    if (customerId === lastCustomerId.current) return;
    lastCustomerId.current = customerId;

    const customer = customers.find((c) => c.id === customerId);
    if (customer) {
      setCurrency(customer.currency_code);
      // Default due date = today + payment_terms_days. Operator can
      // still override below.
      const days = customer.payment_terms_days ?? 0;
      const due = new Date();
      due.setDate(due.getDate() + days);
      setDueDate(due.toISOString().slice(0, 10));
    }

    setCoUuid(null);
    fetchConfirmedCOsForCustomer(customerId).then(setAvailableCos);
  }, [customerId, customers]);

  const eligibleCustomers = customers.filter(
    (c) => c.effective_approval_status === "approved",
  );

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

    const sharedInput = {
      currency_code: currency,
      invoice_date: invoiceDate,
      due_date: dueDate || null,
      customer_reference: customerRef.trim() || null,
      free_text: freeText.trim() || null,
    };

    startTransition(async () => {
      const res = coUuid
        ? await createInvoiceFromCOAction(coUuid, sharedInput)
        : await createCustomerInvoiceAction({
            ...sharedInput,
            customer_id: customerId,
          });

      if (res.ok) {
        toast.success(coUuid ? "Invoice generated from CO" : "Draft invoice created");
        router.push(`/sales/invoices/${res.customer_invoice.uuid}`);
      } else {
        setErrors(res.fields ?? {});
        setActionError(res);
      }
    });
  }

  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle>Invoice details</CardTitle>
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
                No effectively-approved customers — approve a customer first.
              </p>
            )}
            <FieldError messages={errors.customer_id} />
          </FormRow>

          {customerId !== null && (
            <FormRow label="Source CO (optional)">
              <Select
                value={coUuid ?? "none"}
                onValueChange={(v) => setCoUuid(v === "none" ? null : v)}
                disabled={availableCos.length === 0}
              >
                <SelectTrigger className="h-11">
                  <SelectValue
                    placeholder={
                      availableCos.length === 0
                        ? "No confirmed COs to invoice"
                        : "Pick a CO (auto-pulls lines)"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Standalone invoice —</SelectItem>
                  {availableCos.map((co) => (
                    <SelectItem key={co.id} value={co.uuid}>
                      {co.code ?? `#${co.id}`} · {co.grand_total}{" "}
                      {co.currency_code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {availableCos.length === 0 && customerId && (
                <p className="text-[11px] text-muted-foreground">
                  Confirm a CO for this customer first, or proceed without one
                  for a one-off invoice (you can add lines on the next screen).
                </p>
              )}
            </FormRow>
          )}

          <FormRow label="Currency">
            <CurrencyPicker
              value={currency}
              onChange={(v) => setCurrency(v ?? company.currency_code)}
            />
          </FormRow>

          <FormRow label="Invoice date *">
            <Input
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
              className="h-11"
            />
            <FieldError messages={errors.invoice_date} />
          </FormRow>

          <FormRow label="Due date">
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="h-11"
            />
            <p className="text-[11px] text-muted-foreground">
              Defaults to invoice date + customer&rsquo;s payment terms.
            </p>
            <FieldError messages={errors.due_date} />
          </FormRow>

          <FormRow label="Customer reference">
            <Input
              value={customerRef}
              onChange={(e) => setCustomerRef(e.target.value)}
              placeholder="Their PO number, if applicable"
              className="h-11"
            />
          </FormRow>

          <FormRow label="Notes (free text)">
            <Textarea
              rows={3}
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
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
              {coUuid ? "Generate invoice from CO" : "Create draft"}
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
