"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { HandCoins, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  SearchPicker,
  type SearchPickerOption,
} from "@/components/forms/search-picker";
import {
  formatCompanyMoney,
  formatCompanyNumber,
} from "@/lib/format/company";
import type {
  CompanyDefaults,
  Vendor,
  VendorPurchaseTerm,
} from "@/lib/types";
import {
  savePurchaseTermAction,
  deletePurchaseTermAction,
  type PurchaseTermInput,
} from "@/lib/purchase-terms";

interface Props {
  vendor: Vendor;
  terms: VendorPurchaseTerm[];
  prefs: CompanyDefaults;
  canEdit: boolean;
}

interface ItemOption extends SearchPickerOption {
  itemType: string;
}

/**
 * Vendor detail — purchase terms card. Full CRUD lives here (the
 * canonical vendor-owned data). The item detail page has a mirror
 * read-only listing.
 *
 * Approval gate: the BE refuses `savePurchaseTermAction` when the
 * vendor isn't on the item's approved-supplier list. On that error
 * we surface a toast telling the operator to approve first.
 */
export function VendorPurchaseTermsCard({
  vendor,
  terms,
  prefs,
  canEdit,
}: Props) {
  const [editingRow, setEditingRow] = useState<VendorPurchaseTerm | null>(
    null,
  );
  const [creating, setCreating] = useState(false);

  return (
    <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      <header className="mb-3 flex items-center gap-2">
        <HandCoins className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold tracking-tight">
          Purchase terms
        </h2>
        <span className="text-[11px] text-muted-foreground">
          {terms.length}
        </span>
        {canEdit && (
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={() => setCreating(true)}
          >
            <Plus className="mr-1.5 size-3.5" />
            Add term
          </Button>
        )}
      </header>

      <p className="mb-3 text-[11px] text-muted-foreground">
        Vendor-quoted commercial baseline per item. Backs the PO
        &quot;suggest unit price&quot; endpoint when no purchase history
        exists yet. Priority 1 = primary vendor for this item.
      </p>

      {terms.length === 0 ? (
        <p className="rounded-md border border-dashed border-border/60 px-3 py-6 text-center text-xs text-muted-foreground">
          No purchase terms yet. Approve items on the list above, then
          add terms so new POs can default their unit price.
        </p>
      ) : (
        <div className="overflow-hidden rounded-md border border-border/60">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Item</th>
                <th className="px-3 py-2 text-center font-medium">Priority</th>
                <th className="px-3 py-2 text-left font-medium">
                  Vendor part
                </th>
                <th className="px-3 py-2 text-right font-medium">Lead</th>
                <th className="px-3 py-2 text-right font-medium">Price/UoM</th>
                <th className="px-3 py-2 text-right font-medium">Min qty</th>
                {canEdit && (
                  <th className="w-24 px-3 py-2 text-right font-medium">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {terms.map((row) => (
                <TermRow
                  key={row.uuid}
                  row={row}
                  prefs={prefs}
                  canEdit={canEdit}
                  onEdit={() => setEditingRow(row)}
                  vendorUuid={vendor.uuid}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(creating || editingRow) && (
        <TermModal
          vendor={vendor}
          existing={editingRow}
          approvedItems={vendor.approved_items}
          onClose={() => {
            setCreating(false);
            setEditingRow(null);
          }}
        />
      )}
    </section>
  );
}

function TermRow({
  row,
  prefs,
  canEdit,
  vendorUuid,
  onEdit,
}: {
  row: VendorPurchaseTerm;
  prefs: CompanyDefaults;
  canEdit: boolean;
  vendorUuid: string;
  onEdit: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const onDelete = () => {
    if (!confirm("Remove this purchase term? PO defaults will fall back to blank.")) {
      return;
    }
    startTransition(async () => {
      const res = await deletePurchaseTermAction(
        vendorUuid,
        row.uuid,
        row.item?.uuid ?? null,
      );
      if (res.ok) {
        toast.success("Purchase term removed");
        router.refresh();
      } else {
        toast.error(res.detail);
      }
    });
  };

  return (
    <tr>
      <td className="px-3 py-2">
        {row.item?.uuid ? (
          <Link
            href={`/production/items/${row.item.uuid}`}
            className="block group"
          >
            <p className="truncate text-sm font-medium underline-offset-2 group-hover:underline">
              {row.item.name}
            </p>
            <p className="truncate font-mono text-[10px] text-muted-foreground">
              {row.item.code ?? `#${row.item_id}`}
            </p>
          </Link>
        ) : (
          <p className="truncate text-sm font-medium">
            {`Item #${row.item_id}`}
          </p>
        )}
      </td>
      <td className="px-3 py-2 text-center font-mono text-sm">{row.priority}</td>
      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
        {row.vendor_part_no ?? "—"}
      </td>
      <td className="px-3 py-2 text-right font-mono text-sm text-muted-foreground">
        {row.lead_time_days != null ? `${row.lead_time_days} d` : "—"}
      </td>
      <td className="px-3 py-2 text-right font-mono text-sm font-semibold">
        {formatCompanyMoney(row.price, prefs, {
          currency_code: row.currency_code,
        })}
      </td>
      <td className="px-3 py-2 text-right font-mono text-sm text-muted-foreground">
        {row.min_quantity
          ? `${formatCompanyNumber(row.min_quantity, prefs)} ${row.min_quantity_uom ?? ""}`.trim()
          : "—"}
      </td>
      {canEdit && (
        <td className="px-3 py-2 text-right">
          <div className="inline-flex items-center gap-1">
            <button
              type="button"
              onClick={onEdit}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Edit term"
            >
              <Pencil className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={pending}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
              aria-label="Delete term"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </td>
      )}
    </tr>
  );
}

/**
 * Create + edit modal. When editing, the item is fixed (part of the
 * unique key); when creating, the operator picks from the vendor's
 * approved-items list — enforcing the BE's approval-first rule
 * client-side so the operator sees the constraint before the roundtrip.
 */
function TermModal({
  vendor,
  existing,
  approvedItems,
  onClose,
}: {
  vendor: Vendor;
  existing: VendorPurchaseTerm | null;
  approvedItems: Vendor["approved_items"];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Pre-fill from existing row when editing; blank on create.
  const [itemId, setItemId] = useState<number | null>(
    existing?.item_id ?? null,
  );
  const [priority, setPriority] = useState<string>(
    existing ? String(existing.priority) : "1",
  );
  const [price, setPrice] = useState<string>(existing?.price ?? "");
  const [currency, setCurrency] = useState<string>(
    existing?.currency_code ?? vendor.currency_code ?? "GBP",
  );
  const [vendorPartNo, setVendorPartNo] = useState<string>(
    existing?.vendor_part_no ?? "",
  );
  const [leadTime, setLeadTime] = useState<string>(
    existing?.lead_time_days != null ? String(existing.lead_time_days) : "",
  );
  const [minQty, setMinQty] = useState<string>(existing?.min_quantity ?? "");
  const [minQtyUom, setMinQtyUom] = useState<string>(
    existing?.min_quantity_uom ?? "",
  );
  const [notes, setNotes] = useState<string>(existing?.notes ?? "");

  const itemOptions = useMemo<ItemOption[]>(
    () =>
      approvedItems
        .filter((a) => a.item !== null)
        .map((a) => ({
          id: a.item_id,
          label: a.item!.name,
          code: a.item!.code ?? null,
          sublabel: a.item!.item_type ?? null,
          itemType: a.item!.item_type ?? "",
        })),
    [approvedItems],
  );
  const selectedOption = useMemo<ItemOption | null>(
    () => (itemId ? itemOptions.find((o) => o.id === itemId) ?? null : null),
    [itemId, itemOptions],
  );

  const fetchApprovedItems = useCallback(
    async (query: string): Promise<ItemOption[]> => {
      const q = query.trim().toLowerCase();
      if (!q) return itemOptions;
      return itemOptions.filter(
        (o) =>
          o.label.toLowerCase().includes(q) ||
          (o.code ?? "").toLowerCase().includes(q),
      );
    },
    [itemOptions],
  );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!existing && !itemId) {
      toast.error("Pick an approved item first.");
      return;
    }
    if (!price || Number(price) <= 0) {
      toast.error("Enter a positive price.");
      return;
    }

    const input: PurchaseTermInput = {
      item_id: existing ? undefined : itemId!,
      vendor_part_no: vendorPartNo.trim() || null,
      lead_time_days: leadTime ? Number(leadTime) : null,
      price: price.trim(),
      currency_code: currency.trim().toUpperCase(),
      min_quantity: minQty.trim() || null,
      min_quantity_uom: minQtyUom.trim() || null,
      priority: Number(priority) || 1,
      notes: notes.trim() || null,
    };

    startTransition(async () => {
      const res = await savePurchaseTermAction(
        vendor.uuid,
        input,
        existing?.uuid,
      );
      if (res.ok) {
        toast.success(existing ? "Purchase term updated" : "Purchase term added");
        router.refresh();
        onClose();
      } else {
        toast.error(res.detail);
      }
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <form
        onSubmit={onSubmit}
        className="w-full max-w-lg rounded-lg border border-border bg-card p-5 shadow-lg"
      >
        <h3 className="mb-4 text-sm font-semibold">
          {existing ? "Edit purchase term" : "Add purchase term"}
        </h3>

        <div className="space-y-3">
          {existing ? (
            <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs">
              <span className="text-muted-foreground">Item:</span>{" "}
              <span className="font-medium">{existing.item?.name ?? `#${existing.item_id}`}</span>
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Item (from approved list)
              </label>
              <SearchPicker<ItemOption>
                fetcher={fetchApprovedItems}
                value={selectedOption}
                onChange={(o) => setItemId(o?.id ?? null)}
                placeholder="Pick an approved item…"
                emptyHint={
                  itemOptions.length === 0
                    ? "No approved items — approve one first."
                    : "No match."
                }
              />
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <Field label="Priority" hint="1 = primary">
              <input
                type="number"
                min={1}
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              />
            </Field>
            <Field label="Price" hint="per UoM">
              <input
                type="text"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="6.37"
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm font-mono"
              />
            </Field>
            <Field label="Currency">
              <input
                type="text"
                maxLength={3}
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm font-mono uppercase"
              />
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Lead time" hint="days">
              <input
                type="number"
                min={0}
                value={leadTime}
                onChange={(e) => setLeadTime(e.target.value)}
                placeholder="7"
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              />
            </Field>
            <Field label="Min qty">
              <input
                type="text"
                inputMode="decimal"
                value={minQty}
                onChange={(e) => setMinQty(e.target.value)}
                placeholder="25"
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm font-mono"
              />
            </Field>
            <Field label="UoM">
              <input
                type="text"
                value={minQtyUom}
                onChange={(e) => setMinQtyUom(e.target.value)}
                placeholder="kg"
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              />
            </Field>
          </div>

          <Field label="Vendor part no." hint="supplier's SKU for our item">
            <input
              type="text"
              value={vendorPartNo}
              onChange={(e) => setVendorPartNo(e.target.value)}
              placeholder="68"
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
          </Field>

          <Field label="Notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
          </Field>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : existing ? "Save changes" : "Add term"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="flex items-baseline justify-between text-[11px] uppercase tracking-wider text-muted-foreground">
        <span>{label}</span>
        {hint && <span className="text-[10px] normal-case">{hint}</span>}
      </label>
      {children}
    </div>
  );
}
