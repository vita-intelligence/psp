import { AlertTriangle, CheckCircle2, FileWarning } from "lucide-react";
import { formatCompanyMoney } from "@/lib/format/company";
import { getCompanyDefaults } from "@/lib/company/server";
import type { ProcurementInvoice } from "@/lib/invoices/types";
import type { PurchaseOrder } from "@/lib/types";

interface Props {
  po: PurchaseOrder;
  invoices: ProcurementInvoice[];
}

type Severity = "ok" | "info" | "warn" | "danger";

interface Item {
  severity: Severity;
  text: string;
}

/**
 * Surfaces the outstanding paperwork on a PO so the team can't lose
 * track of a missing receipt, an unrecorded invoice, or an unpaid
 * bill. Renders the most critical concerns at the top of the PO
 * detail page until every step in the chain (ordered → received →
 * invoiced → paid) is settled.
 */
export async function POPaperworkAlert({ po, invoices }: Props) {
  // Skip pre-ordered + cancelled — those don't have paperwork
  // obligations yet (or any more).
  if (["draft", "pending_approver", "pending_director", "cancelled"].includes(po.status)) {
    return null;
  }

  const prefs = await getCompanyDefaults();
  const items = computeItems(po, invoices, prefs);

  if (items.length === 0) return null;

  const severity = items.reduce<Severity>((max, i) => {
    if (rank(i.severity) > rank(max)) return i.severity;
    return max;
  }, "ok");

  const tone =
    severity === "danger"
      ? {
          wrap: "border-red-500/40 bg-red-500/[0.06]",
          icon: "text-red-700",
          title: "Outstanding paperwork — action required",
        }
      : severity === "warn"
        ? {
            wrap: "border-amber-500/40 bg-amber-500/[0.06]",
            icon: "text-amber-700",
            title: "Outstanding paperwork",
          }
        : severity === "info"
          ? {
              wrap: "border-border/60 bg-muted/30",
              icon: "text-muted-foreground",
              title: "In progress",
            }
          : {
              wrap: "border-emerald-500/40 bg-emerald-500/[0.05]",
              icon: "text-emerald-700",
              title: "All paperwork settled",
            };

  const Icon =
    severity === "ok"
      ? CheckCircle2
      : severity === "info"
        ? FileWarning
        : AlertTriangle;

  return (
    <section
      aria-label="Paperwork status"
      className={`rounded-lg border ${tone.wrap} p-4`}
    >
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 size-5 shrink-0 ${tone.icon}`} />
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-sm font-semibold">{tone.title}</p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {items.map((it, i) => (
              <li key={i} className="flex items-start gap-2">
                <span
                  className={`mt-1 size-1.5 shrink-0 rounded-full ${
                    it.severity === "danger"
                      ? "bg-red-600"
                      : it.severity === "warn"
                        ? "bg-amber-600"
                        : it.severity === "info"
                          ? "bg-muted-foreground/60"
                          : "bg-emerald-600"
                  }`}
                  aria-hidden
                />
                <span className="leading-relaxed text-foreground/85">
                  {it.text}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function rank(s: Severity): number {
  return s === "danger" ? 3 : s === "warn" ? 2 : s === "info" ? 1 : 0;
}

function computeItems(
  po: PurchaseOrder,
  invoices: ProcurementInvoice[],
  prefs: Awaited<ReturnType<typeof getCompanyDefaults>>,
): Item[] {
  const items: Item[] = [];
  const today = new Date().toISOString().slice(0, 10);
  const fmt = (n: number | string | null) =>
    formatCompanyMoney(n ?? 0, prefs, { currency_code: po.currency_code });

  // 1. Receipt obligations ----------------------------------------------
  if (po.status === "ordered") {
    const expected = po.expected_delivery_date;
    if (expected && expected < today) {
      const daysLate = daysBetween(expected, today);
      items.push({
        severity: "danger",
        text: `Goods overdue by ${daysLate} day${daysLate === 1 ? "" : "s"} (expected ${formatDate(expected)}). Chase the vendor for a shipping update.`,
      });
    } else if (expected) {
      const daysOut = daysBetween(today, expected);
      items.push({
        severity: "warn",
        text: `Goods not yet received. Expected ${formatDate(expected)} (in ${daysOut} day${daysOut === 1 ? "" : "s"}). Chase if no shipping update by then.`,
      });
    } else {
      items.push({
        severity: "danger",
        text: "Goods not yet received and no expected delivery date set. Set one to drive overdue alerts.",
      });
    }
  } else if (po.status === "partially_received") {
    items.push({
      severity: "warn",
      text: "Partial delivery only. Remaining lines still outstanding — record receipts as they arrive.",
    });
  }

  // 2. Invoice obligations ----------------------------------------------
  const liveInvoices = invoices.filter((inv) => inv.status !== "void");
  const voidedInvoices = invoices.filter((inv) => inv.status === "void");
  const billed = liveInvoices.reduce(
    (sum, inv) => sum + Number(inv.total_inc_tax ?? 0),
    0,
  );
  const grandTotal = Number(po.grand_total ?? 0);

  const goodsArrived =
    po.status === "received" || po.status === "partially_received";

  // Voided-only state — invoice rows exist but all of them are voided,
  // which means no real vendor paperwork is on file. Loud regardless
  // of whether goods have arrived: voids without a follow-up valid
  // invoice are an obvious paperwork hole.
  if (liveInvoices.length === 0 && voidedInvoices.length > 0) {
    const n = voidedInvoices.length;
    items.push({
      severity: "danger",
      text: `${n} invoice${n === 1 ? "" : "s"} on file but ${n === 1 ? "it is" : "all are"} voided — no real vendor paperwork attached. Add the valid invoice once it arrives.`,
    });
  } else if (goodsArrived && liveInvoices.length === 0) {
    items.push({
      severity: "danger",
      text: "Goods received but no vendor invoice recorded. Add one before month-end close.",
    });
  } else if (goodsArrived && billed > 0 && billed < grandTotal * 0.999) {
    const unbilled = grandTotal - billed;
    items.push({
      severity: "warn",
      text: `Only ${fmt(billed)} of ${fmt(grandTotal)} invoiced — ${fmt(unbilled)} of vendor paperwork still missing.`,
    });
  } else if (billed > grandTotal * 1.001) {
    items.push({
      severity: "warn",
      text: `Vendor has invoiced ${fmt(billed)} — ${fmt(billed - grandTotal)} over PO total. Reconcile before paying.`,
    });
  }

  // 3. Payment / overdue obligations ------------------------------------
  const overdue = liveInvoices.filter(
    (inv) =>
      inv.status === "received" &&
      inv.due_date &&
      inv.due_date < today,
  );
  for (const inv of overdue) {
    const daysLate = daysBetween(inv.due_date!, today);
    items.push({
      severity: "danger",
      text: `Invoice ${inv.invoice_number} (${fmt(inv.total_inc_tax)}) is ${daysLate} day${daysLate === 1 ? "" : "s"} past due. Pay or escalate.`,
    });
  }

  const unpaidNotOverdue = liveInvoices.filter(
    (inv) =>
      inv.status === "received" &&
      !overdue.includes(inv),
  );
  if (unpaidNotOverdue.length > 0 && overdue.length === 0) {
    const totalUnpaid = unpaidNotOverdue.reduce(
      (sum, inv) =>
        sum + Number(inv.total_inc_tax ?? 0) - Number(inv.paid_amount ?? 0),
      0,
    );
    items.push({
      severity: "warn",
      text: `${fmt(totalUnpaid)} unpaid across ${unpaidNotOverdue.length} invoice${unpaidNotOverdue.length === 1 ? "" : "s"} — settle before the due date.`,
    });
  }

  // 4. Disputed -----------------------------------------------------------
  const disputed = liveInvoices.filter((inv) => inv.status === "disputed");
  for (const inv of disputed) {
    items.push({
      severity: "warn",
      text: `Invoice ${inv.invoice_number} is disputed. Resolve with vendor or mark void.`,
    });
  }

  // 5. Happy path acknowledgement ---------------------------------------
  if (
    items.length === 0 &&
    po.status === "received" &&
    liveInvoices.length > 0 &&
    Math.abs(billed - grandTotal) <= grandTotal * 0.001 &&
    liveInvoices.every((inv) => inv.status === "paid")
  ) {
    items.push({
      severity: "ok",
      text: `Received + ${fmt(billed)} fully invoiced + paid. PO can be archived.`,
    });
  }

  return items;
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  return Math.max(0, Math.round((to - from) / (24 * 60 * 60 * 1000)));
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
  }).format(d);
}
