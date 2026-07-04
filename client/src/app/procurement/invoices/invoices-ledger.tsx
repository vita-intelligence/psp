"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AlertTriangle, Paperclip, Receipt } from "lucide-react";
import { DataTable } from "@/components/data-table";
import type {
  ColumnFilterValue,
  DataTableColumn,
  FilterDef,
  PageResult,
  SortSpec,
} from "@/components/data-table";
import { serializeColumnFilters } from "@/lib/data-table/serialize";
import { Badge } from "@/components/ui/badge-mini";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  formatCompanyDate,
  formatCompanyMoney,
} from "@/lib/format/company";
import { useFormatPrefs } from "@/lib/format/company-prefs-context";
import type {
  ProcurementInvoice,
  ProcurementInvoiceListPage,
  ProcurementInvoiceStatus,
  ProcurementInvoiceTotals,
} from "@/lib/invoices/types";
import { InvoiceForm } from "../purchase-orders/[uuid]/invoice-form";

interface Props {
  initialPage: ProcurementInvoiceListPage;
  companyCurrency: string;
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

const STATUS_FILTER: FilterDef = {
  field: "status",
  label: "Status",
  options: [
    { label: "Received", value: "received" },
    { label: "Disputed", value: "disputed" },
    { label: "Paid", value: "paid" },
    { label: "Void", value: "void" },
    { label: "Overdue", value: "overdue" },
  ],
};

const DEFAULT_SORT: SortSpec = { field: "invoice_date", direction: "desc" };

async function fetchInvoicesPage(params: {
  cursor: string | null;
  limit: number;
  sort: SortSpec | null;
  filters: Record<string, string | boolean | number>;
  columnFilters: Record<string, ColumnFilterValue>;
  search: string;
}): Promise<PageResult<ProcurementInvoice>> {
  const qs = new URLSearchParams();
  qs.set("limit", String(params.limit));
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.sort)
    qs.set("sort", `${params.sort.field}:${params.sort.direction}`);
  if (params.search) qs.set("search", params.search);
  for (const [k, v] of Object.entries(params.filters)) {
    qs.set(k, String(v));
  }
  serializeColumnFilters(qs, params.columnFilters);
  const res = await fetch(`/api/procurement/invoices?${qs.toString()}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { detail?: string };
      if (body?.detail) detail = body.detail;
    } catch {
      /* leave default */
    }
    throw new Error(detail);
  }
  return (await res.json()) as PageResult<ProcurementInvoice>;
}

type DialogMode =
  | { kind: "closed" }
  | { kind: "edit"; invoice: ProcurementInvoice };

/**
 * MRPEasy-style global AP-ledger view. Header stacks per-currency
 * totals (subtotal / tax / total inc / paid). Per-row click opens
 * the same realtime collab edit form used by the PO detail card.
 * Add-invoice CTA is hidden — invoices must originate from a PO.
 */
export function InvoicesLedger({
  initialPage,
  companyCurrency,
  canManage,
  canApprove: _canApprove,
}: Props) {
  const router = useRouter();
  const prefs = useFormatPrefs();
  const [dialog, setDialog] = useState<DialogMode>({ kind: "closed" });

  const filters = useMemo<FilterDef[]>(() => [STATUS_FILTER], []);

  const columns = useMemo<DataTableColumn<ProcurementInvoice>[]>(
    () => [
      {
        id: "po_code",
        header: "PO",
        widthClassName: "w-28",
        cell: (i) =>
          i.purchase_order ? (
            <Link
              href={`/procurement/purchase-orders/${i.purchase_order.uuid}`}
              onClick={(e) => e.stopPropagation()}
              className="font-mono text-xs font-semibold text-muted-foreground hover:underline"
            >
              {i.purchase_order.code ?? `#${i.purchase_order_id}`}
            </Link>
          ) : (
            <span className="font-mono text-xs text-muted-foreground/50">
              —
            </span>
          ),
      },
      {
        id: "invoice_number",
        header: "Invoice ID",
        widthClassName: "min-w-[10rem]",
        cell: (i) => (
          <div className="min-w-0">
            <p className="truncate font-mono text-sm font-semibold">
              {i.invoice_number}
            </p>
            {i.derived_overdue && (
              <span className="mt-1 inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
                <AlertTriangle className="size-2.5" />
                Overdue
              </span>
            )}
          </div>
        ),
      },
      {
        id: "invoice_date",
        header: "Invoice date",
        sortField: "invoice_date",
        widthClassName: "w-32",
        cell: (i) => (
          <span className="text-xs text-muted-foreground">
            {formatCompanyDate(i.invoice_date, prefs)}
          </span>
        ),
      },
      {
        id: "due_date",
        header: "Due date",
        sortField: "due_date",
        widthClassName: "w-32",
        cell: (i) =>
          i.due_date ? (
            <span className="text-xs text-muted-foreground">
              {formatCompanyDate(i.due_date, prefs)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "vendor",
        header: "Vendor",
        widthClassName: "min-w-[12rem]",
        cell: (i) =>
          i.purchase_order?.vendor ? (
            <span className="truncate text-sm">
              {i.purchase_order.vendor.name}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "subtotal",
        header: "Subtotal",
        align: "right",
        widthClassName: "w-28",
        defaultHidden: true,
        cell: (i) => (
          <span className="font-mono text-xs text-muted-foreground">
            {formatCompanyMoney(i.subtotal, prefs, {
              currency_code: i.currency_code,
            })}
          </span>
        ),
      },
      {
        id: "tax_amount",
        header: "Tax",
        align: "right",
        widthClassName: "w-24",
        defaultHidden: true,
        cell: (i) => (
          <span className="font-mono text-xs text-muted-foreground">
            {formatCompanyMoney(i.tax_amount, prefs, {
              currency_code: i.currency_code,
            })}
          </span>
        ),
      },
      {
        id: "total_inc_tax",
        header: "Total inc tax",
        sortField: "total_inc_tax",
        align: "right",
        widthClassName: "w-32",
        cell: (i) => (
          <span className="font-mono text-sm font-semibold">
            {formatCompanyMoney(i.total_inc_tax, prefs, {
              currency_code: i.currency_code,
            })}
          </span>
        ),
      },
      {
        id: "paid_amount",
        header: "Paid",
        sortField: "paid_amount",
        align: "right",
        widthClassName: "w-28",
        cell: (i) => (
          <span className="font-mono text-sm text-muted-foreground">
            {formatCompanyMoney(i.paid_amount, prefs, {
              currency_code: i.currency_code,
            })}
          </span>
        ),
      },
      {
        id: "status",
        header: "Status",
        sortField: "status",
        widthClassName: "w-28",
        cell: (i) => (
          <Badge tone={STATUS_TONE[i.status]}>{STATUS_LABEL[i.status]}</Badge>
        ),
      },
      {
        id: "file",
        header: "File",
        widthClassName: "w-16",
        hideable: true,
        defaultHidden: true,
        cell: (i) =>
          i.file ? (
            <a
              href={i.file.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              title={i.file.filename}
              className="inline-flex text-muted-foreground hover:text-foreground"
            >
              <Paperclip className="size-4" />
            </a>
          ) : (
            <span className="text-xs text-muted-foreground/40">—</span>
          ),
      },
    ],
    [prefs],
  );

  return (
    <>
      <TotalsHeader totals={initialPage.totals} companyCurrency={companyCurrency} />

      <DataTable<ProcurementInvoice>
        tableId="procurement-invoices"
        columns={columns}
        rowKey={(i) => String(i.id)}
        fetchPage={fetchInvoicesPage}
        initialPage={{
          items: initialPage.items,
          next_cursor: initialPage.next_cursor,
        }}
        defaultSort={DEFAULT_SORT}
        searchPlaceholder="Search invoice #, notes…"
        filters={filters}
        onRowClick={(i) => {
          if (canManage) {
            setDialog({ kind: "edit", invoice: i });
          } else if (i.purchase_order) {
            // Viewers — bounce to the PO detail page where they can at
            // least see the invoices card in read-only mode.
            router.push(
              `/procurement/purchase-orders/${i.purchase_order.uuid}`,
            );
          }
        }}
        renderMobileCard={(i) => (
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-sm font-semibold">
                  {i.invoice_number}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {i.purchase_order?.vendor?.name ?? "—"} ·{" "}
                  {i.purchase_order?.code ?? `#${i.purchase_order_id}`}
                </p>
              </div>
              <Badge tone={STATUS_TONE[i.status]}>
                {STATUS_LABEL[i.status]}
              </Badge>
            </div>
            <p className="text-right font-mono text-sm font-semibold">
              {formatCompanyMoney(i.total_inc_tax, prefs, {
                currency_code: i.currency_code,
              })}
            </p>
          </div>
        )}
        emptyState={
          <div className="space-y-1">
            <Receipt className="mx-auto size-8 text-muted-foreground/40" />
            <p className="text-sm font-medium">No invoices yet</p>
            <p className="text-xs text-muted-foreground">
              Vendor invoices appear here once recorded against a PO.
            </p>
          </div>
        }
      />

      <Dialog
        open={dialog.kind !== "closed"}
        onOpenChange={(open) => {
          if (!open) setDialog({ kind: "closed" });
        }}
      >
        <DialogContent className="max-w-2xl max-h-[92vh] flex flex-col p-0">
          <DialogHeader className="sr-only">
            <DialogTitle>
              {dialog.kind === "edit"
                ? `Edit invoice ${dialog.invoice.invoice_number}`
                : "Invoice"}
            </DialogTitle>
            <DialogDescription>
              Realtime collaborative invoice form.
            </DialogDescription>
          </DialogHeader>
          {dialog.kind === "edit" && (
            <InvoiceForm
              invoice={dialog.invoice}
              poUuid={dialog.invoice.purchase_order?.uuid ?? ""}
              poCurrency={dialog.invoice.currency_code}
              companyCurrency={companyCurrency}
              canManage={canManage}
              onDone={() => setDialog({ kind: "closed" })}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

interface TotalsHeaderProps {
  totals: ProcurementInvoiceTotals[];
  companyCurrency: string;
}

function TotalsHeader({ totals, companyCurrency }: TotalsHeaderProps) {
  const prefs = useFormatPrefs();
  if (totals.length === 0) return null;

  return (
    <section
      aria-label="Totals by currency"
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
    >
      {totals.map((row) => (
        <div
          key={row.currency_code}
          className="rounded-lg border border-border/60 bg-card p-4 shadow-sm"
        >
          <div className="mb-2 flex items-baseline justify-between">
            <span className="font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {row.currency_code}
              {row.currency_code === companyCurrency && (
                <span className="ml-1 text-[10px] text-muted-foreground/60">
                  · base
                </span>
              )}
            </span>
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="text-right font-mono">
              {formatCompanyMoney(row.subtotal, prefs, {
                currency_code: row.currency_code,
              })}
            </dd>
            <dt className="text-muted-foreground">Tax</dt>
            <dd className="text-right font-mono">
              {formatCompanyMoney(row.tax, prefs, {
                currency_code: row.currency_code,
              })}
            </dd>
            <dt className="font-medium">Total inc tax</dt>
            <dd className="text-right font-mono font-semibold">
              {formatCompanyMoney(row.total_inc_tax, prefs, {
                currency_code: row.currency_code,
              })}
            </dd>
            <dt className="text-emerald-700 dark:text-emerald-400">Paid</dt>
            <dd className="text-right font-mono text-emerald-700 dark:text-emerald-400">
              {formatCompanyMoney(row.paid, prefs, {
                currency_code: row.currency_code,
              })}
            </dd>
          </dl>
        </div>
      ))}
    </section>
  );
}
