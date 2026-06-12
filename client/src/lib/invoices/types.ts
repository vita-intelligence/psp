import type { AuditActor, VendorSummary } from "../types";

export type ProcurementInvoiceStatus =
  | "received"
  | "disputed"
  | "paid"
  | "void";

/** Status filter understood by the global ledger — adds the derived
 *  `overdue` bucket. Backend reads this from the `status` query param. */
export type ProcurementInvoiceStatusFilter =
  | ProcurementInvoiceStatus
  | "overdue";

/** Slim PO + vendor reference attached to every invoice payload by the
 *  backend. Comes from `BackendWeb.Payloads.procurement_invoice/1`. */
export interface ProcurementInvoicePO {
  uuid: string;
  code: string | null;
  status: string | null;
  vendor: VendorSummary | null;
}

export interface ProcurementInvoiceFile {
  filename: string;
  mime: string;
  byte_size: number;
  /** Streamed via the BE — keeps ACL in front of the blob. */
  url: string;
}

export interface ProcurementInvoice {
  id: number;
  uuid: string;
  purchase_order_id: number;
  purchase_order: ProcurementInvoicePO | null;

  invoice_number: string;
  invoice_date: string;
  due_date: string | null;

  currency_code: string;
  subtotal: string;
  tax_amount: string;
  total_inc_tax: string;
  paid_amount: string;

  status: ProcurementInvoiceStatus;
  /** Derived on the server — true when `status=received AND due_date < today`.
   *  Surfaced as a separate overlay because it doesn't live as a stored status. */
  derived_overdue: boolean;
  notes: string | null;

  file: ProcurementInvoiceFile | null;

  paid_at: string | null;
  paid_by: AuditActor | null;
  created_by: AuditActor | null;
  updated_by: AuditActor | null;
  inserted_at: string;
  updated_at: string;
}

/** One row of the multi-currency totals header. The MRPEasy-style
 *  ledger stacks one of these per currency present in the filtered set. */
export interface ProcurementInvoiceTotals {
  currency_code: string;
  subtotal: string | null;
  tax: string | null;
  total_inc_tax: string | null;
  paid: string | null;
}

export interface ProcurementInvoiceListPage {
  items: ProcurementInvoice[];
  totals: ProcurementInvoiceTotals[];
  next_cursor: string | null;
}

/** Header attrs every form Save sends. Money totals must add up
 *  server-side; we send `total_inc_tax` explicitly because the
 *  changeset validates `subtotal + tax_amount = total_inc_tax`. */
export interface InvoiceFormInput {
  invoice_number?: string;
  invoice_date?: string | null;
  due_date?: string | null;
  currency_code?: string;
  subtotal?: string;
  tax_amount?: string;
  total_inc_tax?: string;
  paid_amount?: string;
  notes?: string | null;
}
