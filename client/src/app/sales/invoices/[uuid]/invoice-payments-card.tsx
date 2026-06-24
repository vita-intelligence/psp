"use client";

/**
 * Payments card. Lists all recorded payments + a record-payment form
 * (only enabled for sent/partially_paid/paid invoices with the
 * record_payment perm). Refunds = negative amounts.
 *
 * Appending a payment auto-flips invoice status when the balance
 * crosses zero — handled by the server.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Coins,
  CreditCard,
  Landmark,
  Loader2,
  Receipt,
  Wallet,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import type {
  CompanyDefaults,
  CustomerInvoice,
  CustomerInvoicePaymentMethod,
} from "@/lib/types";
import type { ErrorDebug } from "@/lib/errors/types";
import { recordCIPaymentAction } from "@/lib/customer-invoices/actions";
import { formatCompanyDate, formatCompanyNumber } from "@/lib/format/company";

const METHOD_LABEL: Record<CustomerInvoicePaymentMethod, string> = {
  bank_transfer: "Bank transfer",
  card: "Card",
  cash: "Cash",
  cheque: "Cheque",
  other: "Other",
};

const METHOD_ICON: Record<CustomerInvoicePaymentMethod, typeof Coins> = {
  bank_transfer: Landmark,
  card: CreditCard,
  cash: Wallet,
  cheque: Receipt,
  other: Coins,
};

interface Props {
  invoice: CustomerInvoice;
  canRecordPayment: boolean;
  prefs: CompanyDefaults;
}

export function InvoicePaymentsCard({
  invoice,
  canRecordPayment,
  prefs,
}: Props) {
  const [open, setOpen] = useState(false);

  const canRecord =
    canRecordPayment &&
    invoice.status !== "draft" &&
    invoice.status !== "cancelled";

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="text-base">
              Payments{" "}
              <span className="text-sm font-normal text-muted-foreground">
                ({invoice.payments.length})
              </span>
            </CardTitle>
            <CardDescription>
              Record full or partial payments. Status auto-flips to paid
              when outstanding hits zero. Use a negative amount for refunds.
            </CardDescription>
          </div>
          {canRecord && (
            <Button size="sm" onClick={() => setOpen(true)}>
              <Coins className="mr-1.5 size-3.5" />
              Record payment
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {invoice.payments.length === 0 ? (
          <p className="rounded-md border border-dashed border-border/60 px-4 py-6 text-center text-xs text-muted-foreground">
            No payments recorded yet.
          </p>
        ) : (
          <ul className="divide-y divide-border/60 overflow-hidden rounded-md border border-border/60">
            <li className="grid grid-cols-[110px_minmax(0,1fr)_140px_120px] items-center gap-3 bg-muted/30 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span>Date</span>
              <span>Method / reference</span>
              <span>Recorded by</span>
              <span className="text-right">Amount</span>
            </li>
            {invoice.payments.map((p) => {
              const Icon = METHOD_ICON[p.method];
              const isRefund = Number(p.amount) < 0;
              return (
                <li
                  key={p.uuid}
                  className="grid grid-cols-[110px_minmax(0,1fr)_140px_120px] items-center gap-3 px-4 py-2"
                >
                  <span className="text-sm">
                    {formatCompanyDate(p.paid_at, prefs)}
                  </span>
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-sm">
                      <Icon className="size-3.5 text-muted-foreground" />
                      {METHOD_LABEL[p.method]}
                    </p>
                    {p.reference && (
                      <p className="truncate text-[11px] text-muted-foreground">
                        Ref: {p.reference}
                      </p>
                    )}
                    {p.notes && (
                      <p className="truncate text-[11px] italic text-muted-foreground">
                        {p.notes}
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {p.recorded_by?.name ?? "—"}
                  </span>
                  <span
                    className={`text-right font-mono text-sm font-medium ${
                      isRefund ? "text-destructive" : ""
                    }`}
                  >
                    {isRefund ? "" : "+ "}
                    {formatCompanyNumber(p.amount, prefs)}{" "}
                    {invoice.currency_code}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      <RecordPaymentDialog
        open={open}
        onClose={() => setOpen(false)}
        invoice={invoice}
      />
    </Card>
  );
}

function RecordPaymentDialog({
  open,
  onClose,
  invoice,
}: {
  open: boolean;
  onClose: () => void;
  invoice: CustomerInvoice;
}) {
  const router = useRouter();
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState(invoice.outstanding);
  const [method, setMethod] = useState<CustomerInvoicePaymentMethod>("bank_transfer");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<{
    detail: string;
    code?: string;
    debug?: ErrorDebug;
  } | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await recordCIPaymentAction(invoice.uuid, {
        paid_at: paidAt,
        amount: amount,
        method,
        reference: reference.trim() || null,
        notes: notes.trim() || null,
      });
      if (res.ok) {
        toast.success("Payment recorded");
        onClose();
        router.refresh();
      } else {
        setError({ detail: res.detail, code: res.code, debug: res.debug });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>
            Outstanding: <strong>{invoice.outstanding} {invoice.currency_code}</strong>.
            Use a negative amount for refunds — status flips back to
            partially_paid / sent automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Paid on
              </Label>
              <Input
                type="date"
                value={paidAt}
                onChange={(e) => setPaidAt(e.target.value)}
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Amount ({invoice.currency_code})
              </Label>
              <Input
                type="number"
                step="any"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="h-9 font-mono"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Method
            </Label>
            <Select
              value={method}
              onValueChange={(v) => setMethod(v as CustomerInvoicePaymentMethod)}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(
                  Object.keys(METHOD_LABEL) as CustomerInvoicePaymentMethod[]
                ).map((m) => (
                  <SelectItem key={m} value={m}>
                    {METHOD_LABEL[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Reference
            </Label>
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Bank ref / cheque # / receipt #"
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Notes
            </Label>
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {error && (
            <ErrorBanner
              detail={error.detail}
              code={error.code}
              debug={error.debug}
            />
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={pending || !amount.toString().trim()}
          >
            {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
            Record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
