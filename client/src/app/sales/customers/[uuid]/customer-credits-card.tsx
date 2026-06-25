"use client";

/**
 * Customer credit balance + ledger. Granting and redeeming credit
 * happens inline through two dialogs:
 *
 *   - Grant credit (amount + reason) — manual goodwill credit, posts
 *     a `manual_grant` ledger row that increases the balance.
 *   - Redeem against invoice — picks an open invoice for this
 *     customer, applies up to `balance`. The server side spawns a
 *     paired credit-note invoice and decrements the balance.
 *
 * Initial ledger is fetched server-side and passed as `initial`; we
 * `router.refresh()` after each mutation to re-pull the latest snapshot.
 */

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowDownRight,
  ArrowUpRight,
  Gift,
  Loader2,
  Plus,
  Receipt,
  Sparkles,
  Wallet,
} from "lucide-react";
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
import { Badge } from "@/components/ui/badge-mini";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  Customer,
  CustomerCredit,
  LoyaltyProgram,
} from "@/lib/types";
import {
  formatCompanyDate,
  formatCompanyMoney,
} from "@/lib/format/company";
import {
  applyCreditToInvoiceAction,
  grantCreditAction,
} from "@/lib/loyalty/actions";
import type { ErrorResult } from "@/lib/errors/server";

interface Props {
  customer: Customer;
  prefs: CompanyDefaults;
  initial: {
    balance: string;
    currency_code: string;
    items: CustomerCredit[];
  } | null;
  programs: LoyaltyProgram[];
  canGrant: boolean;
}

interface OpenInvoiceSummary {
  id: number;
  uuid: string;
  code: string | null;
  status: string;
  grand_total: string;
  amount_due: string | null;
  currency_code: string;
}

export function CustomerCreditsCard({
  customer,
  prefs,
  initial,
  programs,
  canGrant,
}: Props) {
  const [grantOpen, setGrantOpen] = useState(false);
  const [redeemOpen, setRedeemOpen] = useState(false);

  const balance = initial?.balance ?? "0";
  const currency = initial?.currency_code ?? customer.currency_code;
  const ledger = initial?.items ?? [];

  const enrolledProgram = useMemo(() => {
    if (customer.loyalty_program_id === null) return null;
    return (
      programs.find((p) => p.id === customer.loyalty_program_id) ?? null
    );
  }, [customer.loyalty_program_id, programs]);

  const defaultProgram = useMemo(
    () => programs.find((p) => p.is_default && p.is_active) ?? null,
    [programs],
  );

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <Gift className="size-4 text-muted-foreground" />
              Loyalty credits
            </CardTitle>
            <CardDescription>
              Credits earned from tier crossings on paid invoices — or
              granted manually as goodwill. Redeem against any open
              invoice for this customer.
            </CardDescription>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Balance
            </span>
            <span className="font-mono text-2xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
              {formatCompanyMoney(balance, prefs, {
                currency_code: currency,
              })}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Enrollment */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/40 bg-muted/20 p-3 text-xs">
          <div className="flex items-center gap-2">
            <Sparkles className="size-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">Enrolled in:</span>
            {enrolledProgram ? (
              <Link
                href={`/sales/loyalty/programs/${enrolledProgram.uuid}`}
                className="font-medium hover:underline"
              >
                {enrolledProgram.name}
              </Link>
            ) : defaultProgram ? (
              <span>
                <Link
                  href={`/sales/loyalty/programs/${defaultProgram.uuid}`}
                  className="font-medium hover:underline"
                >
                  {defaultProgram.name}
                </Link>{" "}
                <span className="text-muted-foreground">
                  (company default)
                </span>
              </span>
            ) : (
              <span className="text-muted-foreground">Not enrolled</span>
            )}
          </div>
          <span className="text-[11px] text-muted-foreground">
            Change enrollment from the header form above.
          </span>
        </div>

        {/* Actions */}
        {canGrant && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setGrantOpen(true)}
            >
              <Plus className="mr-1.5 size-4" />
              Grant credit
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => setRedeemOpen(true)}
              disabled={Number(balance) <= 0}
              title={
                Number(balance) <= 0
                  ? "Nothing to redeem — balance is zero."
                  : undefined
              }
            >
              <Receipt className="mr-1.5 size-4" />
              Redeem against invoice
            </Button>
          </div>
        )}

        {/* Ledger */}
        <Ledger rows={ledger} prefs={prefs} fallbackCurrency={currency} />
      </CardContent>

      <GrantDialog
        open={grantOpen}
        onClose={() => setGrantOpen(false)}
        customer={customer}
        currency={currency}
        prefs={prefs}
      />
      <RedeemDialog
        open={redeemOpen}
        onClose={() => setRedeemOpen(false)}
        customer={customer}
        balance={balance}
        currency={currency}
        prefs={prefs}
      />
    </Card>
  );
}

// ============================================================
// Ledger table
// ============================================================

const KIND_TONE: Record<
  CustomerCredit["kind"],
  "emerald" | "sky" | "amber"
> = {
  manual_grant: "emerald",
  rebate_accrual: "sky",
  applied_to_invoice: "amber",
};
const KIND_LABEL: Record<CustomerCredit["kind"], string> = {
  manual_grant: "Granted",
  rebate_accrual: "Accrued",
  applied_to_invoice: "Applied",
};

function Ledger({
  rows,
  prefs,
  fallbackCurrency,
}: {
  rows: CustomerCredit[];
  prefs: CompanyDefaults;
  fallbackCurrency: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border/60 px-4 py-8 text-center text-xs text-muted-foreground">
        <Wallet className="mx-auto mb-2 size-4" />
        No credit activity yet. Once a paid invoice crosses a tier — or
        a worker grants goodwill credit — the ledger will populate here.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">Kind</th>
            <th className="px-3 py-2 text-right">Amount</th>
            <th className="px-3 py-2 text-left">Reason</th>
            <th className="px-3 py-2 text-left">Date</th>
            <th className="px-3 py-2 text-left">Invoice</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/40">
          {rows.map((r) => {
            const amount = Number(r.amount);
            const negative = amount < 0;
            return (
              <tr key={r.id} className="hover:bg-muted/20">
                <td className="px-3 py-2">
                  <Badge tone={KIND_TONE[r.kind]}>{KIND_LABEL[r.kind]}</Badge>
                </td>
                <td
                  className={`px-3 py-2 text-right font-mono ${negative ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"}`}
                >
                  <span className="inline-flex items-center gap-1">
                    {negative ? (
                      <ArrowDownRight className="size-3" />
                    ) : (
                      <ArrowUpRight className="size-3" />
                    )}
                    {formatCompanyMoney(
                      negative ? String(-amount) : String(amount),
                      prefs,
                      {
                        currency_code: r.currency_code || fallbackCurrency,
                      },
                    )}
                  </span>
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {r.reason ?? <span className="text-muted-foreground/50">—</span>}
                </td>
                <td className="px-3 py-2 font-mono text-muted-foreground">
                  {formatCompanyDate(r.inserted_at, prefs)}
                </td>
                <td className="px-3 py-2">
                  {r.source_invoice && (
                    <Link
                      href={`/sales/invoices/${r.source_invoice.uuid}`}
                      className="hover:underline"
                    >
                      {r.source_invoice.code ?? `#${r.source_invoice.id}`}
                    </Link>
                  )}
                  {r.credit_note_invoice && (
                    <Link
                      href={`/sales/invoices/${r.credit_note_invoice.uuid}`}
                      className="hover:underline"
                    >
                      {r.credit_note_invoice.code ??
                        `#${r.credit_note_invoice.id}`}
                    </Link>
                  )}
                  {!r.source_invoice && !r.credit_note_invoice && (
                    <span className="text-muted-foreground/50">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================
// Grant dialog
// ============================================================

function GrantDialog({
  open,
  onClose,
  customer,
  currency,
  prefs,
}: {
  open: boolean;
  onClose: () => void;
  customer: Customer;
  currency: string;
  prefs: CompanyDefaults;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<ErrorResult | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) {
      setAmount("");
      setReason("");
      setError(null);
    }
  }, [open]);

  function run() {
    setError(null);
    startTransition(async () => {
      const res = await grantCreditAction(customer.uuid, {
        amount: amount.trim(),
        currency_code: currency,
        reason: reason.trim() || null,
      });
      if (res.ok) {
        toast.success("Credit granted", {
          description: formatCompanyMoney(amount, prefs, {
            currency_code: currency,
          }),
        });
        onClose();
        router.refresh();
      } else {
        setError(res);
      }
    });
  }

  const canSubmit = Number(amount) > 0 && reason.trim().length > 0 && !pending;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Grant credit</DialogTitle>
          <DialogDescription>
            Adds a goodwill credit to <strong>{customer.name}</strong>.
            The customer can redeem this against any future open invoice
            in {currency}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Amount ({currency}) <span className="text-destructive">*</span>
            </Label>
            <Input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="100.00"
              className="h-11 font-mono"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="What's the trigger for this credit?"
              required
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
            onClick={run}
            disabled={!canSubmit}
          >
            {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
            Grant credit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Redeem dialog
// ============================================================

async function fetchOpenInvoices(
  customerId: number,
): Promise<OpenInvoiceSummary[]> {
  const qs = new URLSearchParams({
    customer_id: String(customerId),
    limit: "50",
  });
  try {
    const res = await fetch(`/api/customer-invoices?${qs.toString()}`, {
      cache: "no-store",
    });
    if (!res.ok) return [];
    const body = (await res.json()) as {
      items: Array<OpenInvoiceSummary & { status: string }>;
    };
    // Open = sent / partially_paid — draft has no balance owed yet, paid
    // doesn't need a credit, cancelled is gone.
    return body.items.filter((inv) =>
      ["sent", "partially_paid"].includes(inv.status),
    );
  } catch {
    return [];
  }
}

function RedeemDialog({
  open,
  onClose,
  customer,
  balance,
  currency,
  prefs,
}: {
  open: boolean;
  onClose: () => void;
  customer: Customer;
  balance: string;
  currency: string;
  prefs: CompanyDefaults;
}) {
  const router = useRouter();
  const [invoices, setInvoices] = useState<OpenInvoiceSummary[]>([]);
  const [invoiceUuid, setInvoiceUuid] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<ErrorResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      setInvoiceUuid(null);
      setAmount("");
      setError(null);
      setInvoices([]);
      return;
    }
    setLoading(true);
    fetchOpenInvoices(customer.id).then((rows) => {
      setInvoices(rows);
      setLoading(false);
    });
  }, [open, customer.id]);

  const balanceNum = Number(balance);
  const amountNum = Number(amount);
  const overBalance = amountNum > balanceNum;

  function run() {
    if (!invoiceUuid) return;
    setError(null);
    startTransition(async () => {
      const res = await applyCreditToInvoiceAction(customer.uuid, {
        invoice_uuid: invoiceUuid,
        amount: amount.trim(),
      });
      if (res.ok) {
        toast.success("Credit applied", {
          description: formatCompanyMoney(amount, prefs, {
            currency_code: currency,
          }),
        });
        onClose();
        router.refresh();
      } else {
        setError(res);
      }
    });
  }

  const canSubmit =
    invoiceUuid !== null &&
    amountNum > 0 &&
    !overBalance &&
    !pending;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Redeem credit against invoice</DialogTitle>
          <DialogDescription>
            Applies up to{" "}
            <strong>
              {formatCompanyMoney(balance, prefs, {
                currency_code: currency,
              })}
            </strong>{" "}
            from {customer.name}&rsquo;s credit balance against one of
            their open invoices. A paired credit-note invoice is issued
            automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Open invoice <span className="text-destructive">*</span>
            </Label>
            <Select
              value={invoiceUuid ?? "none"}
              onValueChange={(v) =>
                setInvoiceUuid(v === "none" ? null : v)
              }
              disabled={loading || invoices.length === 0}
            >
              <SelectTrigger className="h-11">
                <SelectValue
                  placeholder={
                    loading
                      ? "Loading…"
                      : invoices.length === 0
                        ? "No open invoices to apply against"
                        : "Pick an invoice"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Pick —</SelectItem>
                {invoices.map((inv) => (
                  <SelectItem key={inv.uuid} value={inv.uuid}>
                    {inv.code ?? `#${inv.id}`}{" "}
                    · {formatCompanyMoney(inv.grand_total, prefs, {
                      currency_code: inv.currency_code,
                    })}{" "}
                    · {inv.status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Amount ({currency}){" "}
              <span className="text-destructive">*</span>
            </Label>
            <Input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="100.00"
              className="h-11 font-mono"
            />
            <p className="text-[11px] text-muted-foreground">
              Max{" "}
              <span className="font-mono">
                {formatCompanyMoney(balance, prefs, {
                  currency_code: currency,
                })}
              </span>{" "}
              available.
            </p>
            {overBalance && (
              <p className="text-[11px] text-destructive">
                Amount exceeds the available balance.
              </p>
            )}
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
          <Button type="button" onClick={run} disabled={!canSubmit}>
            {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
            Apply credit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
