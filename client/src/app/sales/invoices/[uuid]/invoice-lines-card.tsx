"use client";

/**
 * Invoice lines card. Add / edit / remove rows in draft; locked
 * after send. Two add modes:
 *   * Item line (pick from catalogue)
 *   * Free-text line (description only — for services)
 */

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
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
import { Label } from "@/components/ui/label";
import {
  SearchPicker,
  type SearchPickerOption,
} from "@/components/forms/search-picker";
import { Badge } from "@/components/ui/badge-mini";
import type {
  CompanyDefaults,
  CustomerInvoice,
  CustomerInvoiceLineRow,
} from "@/lib/types";
import {
  addCILineAction,
  removeCILineAction,
  updateCILineAction,
} from "@/lib/customer-invoices/actions";
import { formatCompanyNumber } from "@/lib/format/company";

interface ItemPickerOption extends SearchPickerOption {
  itemId: number;
  uomSymbol: string;
}

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
    uomSymbol: i.stock_uom?.symbol ?? "ea",
  }));
}

interface Props {
  invoice: CustomerInvoice;
  canEdit: boolean;
  prefs: CompanyDefaults;
}

export function InvoiceLinesCard({ invoice, canEdit, prefs }: Props) {
  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="space-y-1.5">
          <CardTitle className="text-base">
            Line items{" "}
            <span className="text-sm font-normal text-muted-foreground">
              ({invoice.lines.length})
            </span>
          </CardTitle>
          <CardDescription>
            Lines pulled from the source CO carry the CO line link
            (&ldquo;from CO line&rdquo;). Free-text lines work for one-off
            services. Locked once the invoice is sent.
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {invoice.lines.length === 0 ? (
          <p className="rounded-md border border-dashed border-border/60 px-4 py-6 text-center text-xs text-muted-foreground">
            No lines yet. {canEdit ? "Add the first one below." : ""}
          </p>
        ) : (
          <ul className="divide-y divide-border/60 overflow-hidden rounded-md border border-border/60">
            <li className="grid grid-cols-[minmax(0,1fr)_90px_120px_120px_auto] items-center gap-3 bg-muted/30 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span>Item / description</span>
              <span className="text-right">Qty</span>
              <span className="text-right">Price / unit</span>
              <span className="text-right">Line total</span>
              <span className="sr-only">Actions</span>
            </li>
            {invoice.lines.map((line) => (
              <LineRow
                key={line.uuid}
                line={line}
                invoiceUuid={invoice.uuid}
                currencyCode={invoice.currency_code}
                canEdit={canEdit}
                prefs={prefs}
              />
            ))}
          </ul>
        )}

        {canEdit && <AddLineForm invoiceUuid={invoice.uuid} currencyCode={invoice.currency_code} />}

        {/* Footer totals */}
        <div className="rounded-md border border-border/40 bg-muted/30 px-4 py-3 text-sm">
          <dl className="grid grid-cols-2 gap-y-1 sm:grid-cols-[1fr_auto]">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="text-right font-mono">
              {formatCompanyNumber(invoice.subtotal, prefs)} {invoice.currency_code}
            </dd>
            {Number(invoice.discount_amount) > 0 && (
              <>
                <dt className="text-muted-foreground">
                  Discount ({invoice.discount_pct}%)
                </dt>
                <dd className="text-right font-mono">
                  − {formatCompanyNumber(invoice.discount_amount, prefs)}{" "}
                  {invoice.currency_code}
                </dd>
              </>
            )}
            {Number(invoice.tax_amount) > 0 && (
              <>
                <dt className="text-muted-foreground">
                  Tax ({invoice.tax_rate}%)
                </dt>
                <dd className="text-right font-mono">
                  {formatCompanyNumber(invoice.tax_amount, prefs)}{" "}
                  {invoice.currency_code}
                </dd>
              </>
            )}
            <dt className="pt-1 font-semibold">Grand total</dt>
            <dd className="pt-1 text-right font-mono font-semibold">
              {formatCompanyNumber(invoice.grand_total, prefs)}{" "}
              {invoice.currency_code}
            </dd>
          </dl>
        </div>
      </CardContent>
    </Card>
  );
}

function AddLineForm({
  invoiceUuid,
  currencyCode,
}: {
  invoiceUuid: string;
  currencyCode: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"item" | "free_text">("item");
  const [picked, setPicked] = useState<ItemPickerOption | null>(null);
  const [description, setDescription] = useState("");
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function add() {
    if (mode === "item" && !picked) {
      setError("Pick an item.");
      return;
    }
    if (mode === "free_text" && !description.trim()) {
      setError("Enter a description.");
      return;
    }
    if (!qty.trim() || !price.trim()) {
      setError("Set qty and price.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await addCILineAction(invoiceUuid, {
        item_id: mode === "item" ? picked?.itemId ?? null : null,
        description: mode === "free_text" ? description.trim() : null,
        qty,
        unit_price: price,
      });
      if (res.ok) {
        toast.success("Line added");
        setPicked(null);
        setDescription("");
        setQty("1");
        setPrice("");
        router.refresh();
      } else {
        setError(res.detail);
      }
    });
  }

  return (
    <div className="space-y-3 rounded-md border border-border/40 bg-muted/30 p-3">
      <div className="flex items-center gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Add a line
        </p>
        <div className="flex rounded-md border border-border/60 bg-card p-0.5 text-[10px]">
          <button
            type="button"
            onClick={() => setMode("item")}
            className={`rounded px-2 py-0.5 ${
              mode === "item"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground"
            }`}
          >
            Item
          </button>
          <button
            type="button"
            onClick={() => setMode("free_text")}
            className={`rounded px-2 py-0.5 ${
              mode === "free_text"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground"
            }`}
          >
            Free text
          </button>
        </div>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_90px_120px_auto] items-center gap-3">
        {mode === "item" ? (
          <SearchPicker<ItemPickerOption>
            fetcher={fetchItemOptions}
            value={picked}
            onChange={(o) => setPicked(o)}
            placeholder="Pick an item…"
          />
        ) : (
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Consulting — October"
            className="h-10"
          />
        )}
        <Input
          type="number"
          min={0}
          step="any"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          placeholder="Qty"
          className="h-10 text-right font-mono"
        />
        <div className="relative">
          <Input
            type="number"
            min={0}
            step="any"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="Price"
            className="h-10 pr-12 text-right font-mono"
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 inline-flex items-center text-xs text-muted-foreground">
            {currencyCode}
          </span>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={add}
          disabled={pending || !qty.trim() || !price.trim()}
        >
          {pending ? (
            <Loader2 className="mr-1.5 size-4 animate-spin" />
          ) : (
            <Plus className="mr-1.5 size-4" />
          )}
          Add
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function LineRow({
  line,
  invoiceUuid,
  currencyCode,
  canEdit,
  prefs,
}: {
  line: CustomerInvoiceLineRow;
  invoiceUuid: string;
  currencyCode: string;
  canEdit: boolean;
  prefs: CompanyDefaults;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [qty, setQty] = useState(line.qty);
  const [price, setPrice] = useState(line.unit_price);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const res = await updateCILineAction(invoiceUuid, line.uuid, {
        qty,
        unit_price: price,
      });
      if (res.ok) {
        toast.success("Line updated");
        setEditing(false);
        router.refresh();
      } else {
        toast.error(res.detail);
      }
    });
  }

  function remove() {
    if (!confirm(`Remove ${line.item?.name ?? line.description ?? "this line"}?`))
      return;
    startTransition(async () => {
      const res = await removeCILineAction(invoiceUuid, line.uuid);
      if (res.ok) {
        toast.success("Line removed");
        router.refresh();
      } else {
        toast.error(res.detail);
      }
    });
  }

  return (
    <li className="grid grid-cols-[minmax(0,1fr)_90px_120px_120px_auto] items-center gap-3 px-4 py-2">
      <div className="min-w-0">
        {line.item?.uuid ? (
          <Link
            href={`/settings/items/${line.item.uuid}`}
            className="block group"
          >
            <p className="truncate text-sm font-medium underline-offset-2 group-hover:underline">
              {line.item.name}
            </p>
            <p className="truncate text-[10px] text-muted-foreground">
              {line.item.code ? <span className="font-mono">{line.item.code}</span> : null}
              {line.customer_order_line_id && (
                <Badge tone="sky" className="ml-1">
                  from CO line
                </Badge>
              )}
            </p>
          </Link>
        ) : (
          <>
            <p className="truncate text-sm font-medium">
              {line.item?.name ?? line.description ?? "—"}
            </p>
            <p className="truncate text-[10px] text-muted-foreground">
              {line.item?.code ? <span className="font-mono">{line.item.code}</span> : null}
              {line.customer_order_line_id && (
                <Badge tone="sky" className="ml-1">
                  from CO line
                </Badge>
              )}
            </p>
          </>
        )}
      </div>
      {editing ? (
        <Input
          type="number"
          min={0}
          step="any"
          value={String(qty)}
          onChange={(e) => setQty(e.target.value)}
          className="h-9 text-right font-mono"
        />
      ) : (
        <span className="text-right font-mono text-sm">
          {formatCompanyNumber(line.qty, prefs)}
        </span>
      )}
      {editing ? (
        <Input
          type="number"
          min={0}
          step="any"
          value={String(price)}
          onChange={(e) => setPrice(e.target.value)}
          className="h-9 text-right font-mono"
        />
      ) : (
        <span className="text-right font-mono text-sm">
          {formatCompanyNumber(line.unit_price, prefs)} {currencyCode}
        </span>
      )}
      <span className="text-right font-mono text-sm font-medium">
        {formatCompanyNumber(line.line_subtotal, prefs)} {currencyCode}
      </span>
      <div className="flex items-center gap-1">
        {canEdit && !editing && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setEditing(true)}
            disabled={pending}
            className="h-8 text-xs"
          >
            Edit
          </Button>
        )}
        {canEdit && editing && (
          <>
            <Button
              type="button"
              size="sm"
              onClick={save}
              disabled={pending}
              className="h-8 text-xs"
            >
              Save
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditing(false);
                setQty(line.qty);
                setPrice(line.unit_price);
              }}
              disabled={pending}
              className="h-8 text-xs"
            >
              Cancel
            </Button>
          </>
        )}
        {canEdit && !editing && (
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
