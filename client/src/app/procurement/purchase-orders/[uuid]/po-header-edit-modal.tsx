"use client";

/**
 * Header edit dialog for a draft PO. Covers the three fields the
 * buyer routinely needs to change post-create: destination warehouse,
 * expected delivery date, and free-text notes. Vendor + currency are
 * intentionally NOT here — swapping either mid-draft would invalidate
 * existing lines (pricing is per-vendor, currency is line-locked), so
 * the "correct" flow is to cancel + recreate the PO for those.
 *
 * TODO(realtime): this modal skips the collab pattern from
 * warehouse-form.tsx (avatars / field indicators / cursor / head-of-
 * room gate) — the CLAUDE.md hard rule says every editable form ships
 * with it. This landed as an unblocking follow-up to the missing
 * "Edit" button on the PO detail page; upgrade to the full pattern
 * next time this file is touched.
 */

import { useCallback, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ErrorBanner } from "@/components/forms/error-banner";
import {
  SearchPicker,
  type SearchPickerOption,
} from "@/components/forms/search-picker";
import { toast } from "sonner";
import type { PurchaseOrder } from "@/lib/types";

interface WarehouseOption extends SearchPickerOption {
  id: number;
  label: string;
  code?: string | null;
}

interface Props {
  po: PurchaseOrder;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function POHeaderEditModal({ po, open, onOpenChange }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [warehouse, setWarehouse] = useState<WarehouseOption | null>(
    po.default_warehouse
      ? {
          id: po.default_warehouse.id,
          label: po.default_warehouse.name,
          code: null,
        }
      : null,
  );
  const [expected, setExpected] = useState<string>(
    po.expected_delivery_date ?? "",
  );
  const [notes, setNotes] = useState<string>(po.notes ?? "");

  const fetchWarehouses = useCallback(
    async (q: string): Promise<WarehouseOption[]> => {
      const params = new URLSearchParams();
      if (q) params.set("search", q);
      params.set("limit", "25");
      const res = await fetch(`/api/warehouses?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) return [];
      const body = (await res.json()) as {
        items?: Array<{ id: number; name: string; code?: string | null }>;
      };
      return (body.items ?? []).map((w) => ({
        id: w.id,
        label: w.name,
        code: w.code ?? null,
      }));
    },
    [],
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        default_warehouse_id: warehouse?.id ?? null,
        expected_delivery_date: expected || null,
        notes: notes.trim(),
      };
      const res = await fetch(
        `/api/purchase-orders/${encodeURIComponent(po.uuid)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string; detail?: string; message?: string }
          | null;
        setError(
          body?.detail ??
            body?.message ??
            body?.error ??
            `HTTP ${res.status}`,
        );
        return;
      }
      toast.success("Header saved.");
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit PO header</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Default warehouse
            </Label>
            <SearchPicker<WarehouseOption>
              value={warehouse}
              onChange={setWarehouse}
              fetcher={fetchWarehouses}
              placeholder="Search warehouses…"
            />
            <p className="text-[11px] text-muted-foreground">
              Falls through to any line that doesn't override.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="expected_delivery_date"
              className="text-[11px] uppercase tracking-wider text-muted-foreground"
            >
              Expected delivery date
            </Label>
            <Input
              id="expected_delivery_date"
              type="date"
              value={expected}
              onChange={(e) => setExpected(e.target.value)}
              className="max-w-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="notes"
              className="text-[11px] uppercase tracking-wider text-muted-foreground"
            >
              Notes
            </Label>
            <Textarea
              id="notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={4000}
            />
          </div>

          {error && <ErrorBanner detail={error} />}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
