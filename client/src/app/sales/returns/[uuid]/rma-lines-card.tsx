"use client";

/**
 * RMA lines card. Two editing modes:
 *
 *   * Draft (canEdit) — add / edit / remove lines. Each line carries
 *     qty_returned, reason_code, optional reason_notes + unit_price
 *     (snapped from the linked invoice line if available).
 *   * Received (canInspect) — lines are locked structurally; quality
 *     inspects per-line, setting qty_accepted + inspection_notes.
 *
 * Accepted lines show their line_credit_amount once the RMA is
 * resolved.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SearchPicker,
  type SearchPickerOption,
} from "@/components/forms/search-picker";
import type {
  CompanyDefaults,
  CustomerReturn,
  CustomerReturnLineRow,
  CustomerReturnReasonCode,
} from "@/lib/types";
import {
  addCRLineAction,
  removeCRLineAction,
  updateCRLineAction,
} from "@/lib/customer-returns/actions";
import { formatCompanyNumber } from "@/lib/format/company";

interface ItemPickerOption extends SearchPickerOption {
  itemId: number;
}

interface InvoiceLineOption extends SearchPickerOption {
  invoiceLineId: number;
  itemId: number | null;
  unitPrice: string;
  itemName: string;
}

const REASON_OPTIONS: Array<{ value: CustomerReturnReasonCode; label: string }> = [
  { value: "damaged", label: "Damaged" },
  { value: "wrong_item", label: "Wrong item" },
  { value: "quality_fail", label: "Quality fail" },
  { value: "customer_changed_mind", label: "Customer changed mind" },
  { value: "short_shipment", label: "Short shipment" },
  { value: "overshipment", label: "Overshipment" },
  { value: "other", label: "Other" },
];

const REASON_LABEL: Record<CustomerReturnReasonCode, string> = Object.fromEntries(
  REASON_OPTIONS.map((o) => [o.value, o.label]),
) as Record<CustomerReturnReasonCode, string>;

async function fetchItemOptions(
  query: string,
  signal?: AbortSignal,
): Promise<ItemPickerOption[]> {
  const qs = new URLSearchParams({ picker: "true", limit: "50" });
  if (query) qs.set("search", query);
  const res = await fetch(`/api/items?${qs.toString()}`, {
    cache: "no-store",
    signal,
  });
  if (!res.ok) return [];
  const body = (await res.json()) as {
    items: Array<{
      id: number;
      code: string | null;
      name: string;
      stock_uom?: { symbol?: string | null } | null;
    }>;
  };
  return body.items.map((i) => ({
    id: i.id,
    itemId: i.id,
    label: i.name,
    code: i.code,
    sublabel: null,
  }));
}

interface Props {
  rma: CustomerReturn;
  canEdit: boolean;
  canInspect: boolean;
  prefs: CompanyDefaults;
}

export function RMALinesCard({ rma, canEdit, canInspect, prefs }: Props) {
  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="space-y-1.5">
          <CardTitle className="text-base">
            Lines{" "}
            <span className="text-sm font-normal text-muted-foreground">
              ({rma.lines.length})
            </span>
          </CardTitle>
          <CardDescription>
            One row per item the customer returned. In draft, add the
            line and pick a reason. After receiving, quality sets how
            many units we&rsquo;re crediting per line.
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {rma.lines.length === 0 ? (
          <p className="rounded-md border border-dashed border-border/60 px-4 py-6 text-center text-xs text-muted-foreground">
            No lines yet. {canEdit ? "Add the first one below." : ""}
          </p>
        ) : (
          <ul className="divide-y divide-border/60 overflow-hidden rounded-md border border-border/60">
            <li className="grid grid-cols-[minmax(0,1fr)_80px_80px_120px_110px_auto] items-center gap-3 bg-muted/30 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span>Item / reason</span>
              <span className="text-right">Returned</span>
              <span className="text-right">Accepted</span>
              <span className="text-right">Unit price</span>
              <span className="text-right">Credit</span>
              <span className="sr-only">Actions</span>
            </li>
            {rma.lines.map((line) => (
              <LineRow
                key={line.uuid}
                line={line}
                rmaUuid={rma.uuid}
                currencyCode={rma.customer?.currency_code ?? "GBP"}
                canEdit={canEdit}
                canInspect={canInspect}
                prefs={prefs}
              />
            ))}
          </ul>
        )}

        {canEdit && (
          <AddLineForm rma={rma} />
        )}
      </CardContent>
    </Card>
  );
}

function AddLineForm({ rma }: { rma: CustomerReturn }) {
  const router = useRouter();
  const [picked, setPicked] = useState<ItemPickerOption | null>(null);
  const [pickedInvoiceLine, setPickedInvoiceLine] = useState<InvoiceLineOption | null>(null);
  const [qty, setQty] = useState("1");
  const [reason, setReason] = useState<CustomerReturnReasonCode>("damaged");
  const [reasonNotes, setReasonNotes] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // If the RMA is linked to an invoice, prefer letting the operator
  // pick directly from the invoice lines (so qty_returned can't exceed
  // what was actually invoiced + unit_price snaps automatically).
  const invoiceLines = rma.customer_invoice_id ? rma.customer_invoice?.code : null;
  void invoiceLines; // for future use when we load invoice lines client-side

  function add() {
    if (!picked && !pickedInvoiceLine) {
      setError("Pick an item.");
      return;
    }
    if (!qty.trim()) {
      setError("Set returned qty.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await addCRLineAction(rma.uuid, {
        item_id: pickedInvoiceLine?.itemId ?? picked?.itemId ?? null,
        customer_invoice_line_id: pickedInvoiceLine?.invoiceLineId ?? null,
        qty_returned: qty,
        reason_code: reason,
        reason_notes: reasonNotes.trim() || null,
        unit_price: unitPrice.trim() || pickedInvoiceLine?.unitPrice || null,
      });
      if (res.ok) {
        toast.success("Line added");
        setPicked(null);
        setPickedInvoiceLine(null);
        setQty("1");
        setReasonNotes("");
        setUnitPrice("");
        router.refresh();
      } else {
        setError(res.detail);
      }
    });
  }

  return (
    <div className="space-y-3 rounded-md border border-border/40 bg-muted/30 p-3">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        Add a line
      </p>
      <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_80px_120px_auto] items-center gap-3">
        <SearchPicker<ItemPickerOption>
          fetcher={fetchItemOptions}
          value={picked}
          onChange={(o) => setPicked(o)}
          placeholder="Pick an item…"
        />
        <Select
          value={reason}
          onValueChange={(v) => setReason(v as CustomerReturnReasonCode)}
        >
          <SelectTrigger className="h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REASON_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="number"
          min={0}
          step="any"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          placeholder="Qty"
          className="h-10 text-right font-mono"
        />
        <Input
          type="number"
          min={0}
          step="any"
          value={unitPrice}
          onChange={(e) => setUnitPrice(e.target.value)}
          placeholder="Unit price"
          className="h-10 text-right font-mono"
        />
        <Button
          type="button"
          size="sm"
          onClick={add}
          disabled={pending || !picked || !qty.trim()}
        >
          {pending ? (
            <Loader2 className="mr-1.5 size-4 animate-spin" />
          ) : (
            <Plus className="mr-1.5 size-4" />
          )}
          Add
        </Button>
      </div>
      <Input
        value={reasonNotes}
        onChange={(e) => setReasonNotes(e.target.value)}
        placeholder="Reason notes (optional)"
        className="h-9"
      />
      {!rma.customer_invoice_id && (
        <p className="text-[11px] text-muted-foreground">
          No invoice linked — enter the unit price manually (used when issuing the credit note).
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function LineRow({
  line,
  rmaUuid,
  currencyCode,
  canEdit,
  canInspect,
  prefs,
}: {
  line: CustomerReturnLineRow;
  rmaUuid: string;
  currencyCode: string;
  canEdit: boolean;
  canInspect: boolean;
  prefs: CompanyDefaults;
}) {
  const router = useRouter();
  const [qtyAccepted, setQtyAccepted] = useState(
    line.qty_accepted ?? line.qty_returned,
  );
  const [inspectionNotes, setInspectionNotes] = useState(
    line.inspection_notes ?? "",
  );
  const [pending, startTransition] = useTransition();

  function saveInspection() {
    startTransition(async () => {
      const res = await updateCRLineAction(rmaUuid, line.uuid, {
        qty_accepted: qtyAccepted,
        inspection_notes: inspectionNotes.trim() || null,
      });
      if (res.ok) {
        toast.success("Inspection saved");
        router.refresh();
      } else {
        toast.error(res.detail);
      }
    });
  }

  function remove() {
    if (!confirm(`Remove ${line.item?.name ?? "this line"}?`)) return;
    startTransition(async () => {
      const res = await removeCRLineAction(rmaUuid, line.uuid);
      if (res.ok) {
        toast.success("Line removed");
        router.refresh();
      } else {
        toast.error(res.detail);
      }
    });
  }

  const showInspectionInputs = canInspect;
  const acceptedDisplay = line.qty_accepted ?? "—";

  return (
    <li className="grid grid-cols-[minmax(0,1fr)_80px_80px_120px_110px_auto] items-center gap-3 px-4 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">
          {line.item?.name ?? "—"}
        </p>
        <p className="truncate text-[10px] text-muted-foreground">
          {line.item?.code ? <span className="font-mono">{line.item.code}</span> : null}
          {line.item?.code && " · "}
          {REASON_LABEL[line.reason_code]}
          {line.reason_notes && (
            <span className="italic"> — {line.reason_notes}</span>
          )}
        </p>
      </div>
      <span className="text-right font-mono text-sm">
        {formatCompanyNumber(line.qty_returned, prefs)}
      </span>
      {showInspectionInputs ? (
        <Input
          type="number"
          min={0}
          max={Number(line.qty_returned)}
          step="any"
          value={qtyAccepted ?? ""}
          onChange={(e) => setQtyAccepted(e.target.value)}
          onBlur={saveInspection}
          disabled={pending}
          className="h-9 text-right font-mono"
        />
      ) : (
        <span className="text-right font-mono text-sm">
          {acceptedDisplay === "—"
            ? acceptedDisplay
            : formatCompanyNumber(acceptedDisplay, prefs)}
        </span>
      )}
      <span className="text-right font-mono text-sm">
        {formatCompanyNumber(line.unit_price, prefs)} {currencyCode}
      </span>
      <span className="text-right font-mono text-sm font-medium">
        {formatCompanyNumber(line.line_credit_amount, prefs)} {currencyCode}
      </span>
      <div className="flex items-center gap-1">
        {showInspectionInputs && (
          <Input
            value={inspectionNotes}
            onChange={(e) => setInspectionNotes(e.target.value)}
            onBlur={saveInspection}
            placeholder="Notes"
            disabled={pending}
            className="h-9 w-32"
          />
        )}
        {canEdit && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={remove}
            disabled={pending}
            className="size-8 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>
    </li>
  );
}
