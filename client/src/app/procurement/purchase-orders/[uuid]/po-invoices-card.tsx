"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Ban,
  Check,
  Paperclip,
  Plus,
  Receipt,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge-mini";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorBanner } from "@/components/forms/error-banner";
import {
  disputeInvoiceAction,
  markInvoicePaidAction,
  voidInvoiceAction,
} from "@/lib/invoices/actions";
import type {
  ProcurementInvoice,
  ProcurementInvoiceStatus,
} from "@/lib/invoices/types";
import {
  formatCompanyDate,
  formatCompanyMoney,
} from "@/lib/format/company";
import { useFormatPrefs } from "@/lib/format/company-prefs-context";
import type { ErrorResult } from "@/lib/errors/server";
import type { PurchaseOrder } from "@/lib/types";
import { InvoiceForm } from "./invoice-form";

interface Props {
  po: PurchaseOrder;
  companyCurrency: string;
  invoices: ProcurementInvoice[];
  canView: boolean;
  canManage: boolean;
  canApprove: boolean;
}

const STATUS_LABEL: Record<ProcurementInvoiceStatus, string> = {
  received: "Received",
  disputed: "Disputed",
  paid: "Paid",
  void: "Void",
};

const STATUS_TONE: Record<
  ProcurementInvoiceStatus,
  "muted" | "amber" | "emerald" | "destructive"
> = {
  received: "muted",
  disputed: "amber",
  paid: "emerald",
  void: "destructive",
};

type DialogMode =
  | { kind: "closed" }
  | { kind: "create" }
  | { kind: "edit"; invoice: ProcurementInvoice };

/**
 * PO detail "Invoices" card — the AP team's per-PO view of the
 * supplier paperwork landed against this order. Mirrors the layout of
 * the existing receive card; new invoice flow opens an in-dialog
 * collab form that joins the same `form:invoice:<po>:new` room as any
 * peer the AP team has on the same PO.
 *
 * RBAC:
 *   - view-only: card visible, row actions hidden
 *   - manage: Add / edit / dispute / void / delete
 *   - approve: Mark paid action
 */
export function POInvoicesCard({
  po,
  companyCurrency,
  invoices,
  canView,
  canManage,
  canApprove,
}: Props) {
  const poUuid = po.uuid;
  const poCurrency = po.currency_code;
  const router = useRouter();
  const prefs = useFormatPrefs();
  const [dialog, setDialog] = useState<DialogMode>({ kind: "closed" });
  const [pending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<ErrorResult | null>(null);

  if (!canView) return null;

  function closeDialog() {
    setDialog({ kind: "closed" });
  }

  function onMarkPaid(inv: ProcurementInvoice) {
    if (!canApprove) return;
    setActionError(null);
    startTransition(async () => {
      const res = await markInvoicePaidAction(inv.uuid, null, poUuid);
      if (res.ok) {
        toast.success(`Invoice ${inv.invoice_number} marked paid`);
        router.refresh();
      } else {
        setActionError(res);
      }
    });
  }

  function onDispute(inv: ProcurementInvoice) {
    if (!canManage) return;
    const notes = window.prompt(
      "Dispute notes — what's wrong with this invoice?",
      inv.notes ?? "",
    );
    if (notes === null) return;
    setActionError(null);
    startTransition(async () => {
      const res = await disputeInvoiceAction(inv.uuid, notes, poUuid);
      if (res.ok) {
        toast.success("Invoice flagged as disputed");
        router.refresh();
      } else {
        setActionError(res);
      }
    });
  }

  function onVoid(inv: ProcurementInvoice) {
    if (!canManage) return;
    if (
      !window.confirm(
        `Void invoice ${inv.invoice_number}? This is a write-off and is hard to undo.`,
      )
    )
      return;
    setActionError(null);
    startTransition(async () => {
      const res = await voidInvoiceAction(inv.uuid, null, poUuid);
      if (res.ok) {
        toast.success("Invoice voided");
        router.refresh();
      } else {
        setActionError(res);
      }
    });
  }

  // Billed summary across the lifetime of the PO. Void invoices don't
  // count toward the billed total. Status counts let the user see
  // payment progress at a glance without scanning the row list.
  const billed = invoices
    .filter((inv) => inv.status !== "void")
    .reduce((sum, inv) => sum + Number(inv.total_inc_tax ?? 0), 0);
  const paidTotal = invoices
    .filter((inv) => inv.status === "paid")
    .reduce((sum, inv) => sum + Number(inv.paid_amount ?? 0), 0);
  const poTotal = Number(po.grand_total ?? 0);
  const billedDisplay = formatCompanyMoney(billed, prefs, {
    currency_code: po.currency_code,
  });
  const poTotalDisplay = formatCompanyMoney(poTotal, prefs, {
    currency_code: po.currency_code,
  });
  const paidDisplay = formatCompanyMoney(paidTotal, prefs, {
    currency_code: po.currency_code,
  });
  const fullyBilled = poTotal > 0 && billed >= poTotal;
  const overBilled = billed > poTotal && poTotal > 0;
  const countsByStatus = invoices.reduce<
    Partial<Record<ProcurementInvoiceStatus, number>>
  >((acc, inv) => {
    acc[inv.status] = (acc[inv.status] ?? 0) + 1;
    return acc;
  }, {});
  const countsLabel = (
    ["received", "disputed", "paid", "void"] as ProcurementInvoiceStatus[]
  )
    .filter((s) => countsByStatus[s])
    .map((s) => `${countsByStatus[s]} ${STATUS_LABEL[s].toLowerCase()}`)
    .join(" · ");

  return (
    <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Receipt className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold tracking-tight">Invoices</h2>
          <span className="text-[11px] text-muted-foreground">
            {invoices.length}
          </span>
        </div>
        {canManage && (
          <Button
            size="sm"
            onClick={() => setDialog({ kind: "create" })}
            disabled={pending}
          >
            <Plus className="mr-1.5 size-4" />
            Add invoice
          </Button>
        )}
      </header>

      {invoices.length > 0 && (
        <div
          className={`mb-3 rounded-md border px-3 py-2 text-xs ${
            overBilled
              ? "border-amber-500/40 bg-amber-500/5 text-amber-900"
              : fullyBilled
              ? "border-emerald-500/40 bg-emerald-500/5"
              : "border-border/60 bg-muted/30"
          }`}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span>
              <span className="font-medium text-foreground">
                {billedDisplay}
              </span>{" "}
              <span className="text-muted-foreground">
                of {poTotalDisplay} invoiced
              </span>
              {fullyBilled && !overBilled && (
                <span className="ml-2 text-emerald-700">· fully invoiced</span>
              )}
              {overBilled && (
                <span className="ml-2 font-medium">
                  · over PO total
                </span>
              )}
            </span>
            <span className="text-muted-foreground">
              {paidDisplay} paid
              {countsLabel && <> · {countsLabel}</>}
            </span>
          </div>
        </div>
      )}

      {actionError && (
        <div className="mb-3">
          <ErrorBanner
            detail={actionError.detail}
            code={actionError.code}
            debug={actionError.debug}
          />
        </div>
      )}

      {invoices.length === 0 ? (
        <p className="rounded-md border border-dashed border-border/60 px-3 py-6 text-center text-xs text-muted-foreground">
          No invoices yet against this PO.
          {canManage && " Add one when the supplier's paperwork lands."}
        </p>
      ) : (
        <div className="overflow-hidden rounded-md border border-border/60">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Invoice #</th>
                <th className="px-3 py-2 text-left font-medium">Issued</th>
                <th className="px-3 py-2 text-left font-medium">Due</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
                <th className="px-3 py-2 text-right font-medium">Paid</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium">File</th>
                {(canManage || canApprove) && <th className="w-32" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {invoices.map((inv) => (
                <tr key={inv.uuid} className="hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() =>
                        canManage && setDialog({ kind: "edit", invoice: inv })
                      }
                      disabled={!canManage}
                      className="font-mono text-xs font-semibold text-foreground hover:underline disabled:no-underline"
                    >
                      {inv.invoice_number}
                    </button>
                    {inv.derived_overdue && (
                      <div className="mt-1 inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
                        <AlertTriangle className="size-2.5" />
                        Overdue
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {formatCompanyDate(inv.invoice_date, prefs)}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {inv.due_date
                      ? formatCompanyDate(inv.due_date, prefs)
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-sm">
                    {formatCompanyMoney(inv.total_inc_tax, prefs, {
                      currency_code: inv.currency_code,
                    })}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-sm text-muted-foreground">
                    {formatCompanyMoney(inv.paid_amount, prefs, {
                      currency_code: inv.currency_code,
                    })}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={STATUS_TONE[inv.status]}>
                      {STATUS_LABEL[inv.status]}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    {inv.file ? (
                      <a
                        href={inv.file.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={inv.file.filename}
                        className="inline-flex max-w-[160px] items-center gap-1 text-xs underline-offset-2 hover:underline"
                      >
                        <Paperclip className="size-3 shrink-0" />
                        <span className="truncate">{inv.file.filename}</span>
                      </a>
                    ) : (
                      <span className="text-[11px] text-muted-foreground/60">
                        —
                      </span>
                    )}
                  </td>
                  {(canManage || canApprove) && (
                    <td className="px-2 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        {canApprove &&
                          (inv.status === "received" ||
                            inv.status === "disputed") && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => onMarkPaid(inv)}
                              disabled={pending}
                              className="h-7 px-2 text-xs"
                              title="Mark paid"
                            >
                              <Check className="mr-0.5 size-3" />
                              Pay
                            </Button>
                          )}
                        {canManage && inv.status === "received" && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => onDispute(inv)}
                            disabled={pending}
                            className="h-7 px-2 text-xs text-amber-700 hover:bg-amber-50 dark:text-amber-300"
                            title="Flag a discrepancy"
                          >
                            <AlertTriangle className="size-3" />
                          </Button>
                        )}
                        {canManage && inv.status !== "void" && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => onVoid(inv)}
                            disabled={pending}
                            className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                            title="Void"
                          >
                            <Ban className="size-3" />
                          </Button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={dialog.kind !== "closed"}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      >
        <DialogContent className="max-w-2xl max-h-[92vh] flex flex-col p-0">
          <DialogHeader className="sr-only">
            <DialogTitle>
              {dialog.kind === "edit"
                ? `Edit invoice ${dialog.invoice.invoice_number}`
                : "Add invoice"}
            </DialogTitle>
            <DialogDescription>
              Realtime collaborative invoice form.
            </DialogDescription>
          </DialogHeader>
          {dialog.kind !== "closed" && (
            <InvoiceForm
              invoice={dialog.kind === "edit" ? dialog.invoice : null}
              poUuid={poUuid}
              poCurrency={poCurrency}
              companyCurrency={companyCurrency}
              canManage={canManage}
              onDone={closeDialog}
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
