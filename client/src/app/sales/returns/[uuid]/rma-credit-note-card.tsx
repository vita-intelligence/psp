"use client";

import Link from "next/link";
import { FileDown, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge-mini";
import type {
  CompanyDefaults,
  CustomerInvoice,
  CustomerInvoiceStatus,
} from "@/lib/types";
import { formatCompanyDate, formatCompanyNumber } from "@/lib/format/company";

const STATUS_LABEL: Record<CustomerInvoiceStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  partially_paid: "Partially paid",
  paid: "Paid",
  cancelled: "Cancelled",
};

interface Props {
  creditNote: CustomerInvoice;
  prefs: CompanyDefaults;
}

export function RMACreditNoteCard({ creditNote, prefs }: Props) {
  return (
    <section className="rounded-lg border border-emerald-300/60 bg-emerald-50/60 p-5 shadow-sm dark:border-emerald-800/40 dark:bg-emerald-950/30">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <Receipt className="size-4 text-emerald-700 dark:text-emerald-300" />
            Credit note issued
            <Badge tone="emerald">{STATUS_LABEL[creditNote.status]}</Badge>
          </h2>
          <p className="text-xs text-muted-foreground">
            <Link
              href={`/sales/invoices/${creditNote.uuid}`}
              className="font-mono font-medium text-brand hover:underline"
            >
              {creditNote.code ?? `#${creditNote.id}`}
            </Link>{" "}
            · {formatCompanyDate(creditNote.invoice_date, prefs)}
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Credit amount
            </p>
            <p className="font-mono text-lg font-semibold text-emerald-700 dark:text-emerald-300">
              {formatCompanyNumber(creditNote.grand_total, prefs)}{" "}
              {creditNote.currency_code}
            </p>
          </div>
          <Button asChild size="sm" variant="outline">
            <a
              href={`/api/customer-invoices/${creditNote.uuid}/documents/pdf`}
              target="_blank"
              rel="noreferrer"
            >
              <FileDown className="mr-1.5 size-3.5" />
              PDF
            </a>
          </Button>
        </div>
      </div>
    </section>
  );
}
