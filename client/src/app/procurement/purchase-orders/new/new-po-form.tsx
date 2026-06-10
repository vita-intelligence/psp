"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorBanner } from "@/components/forms/error-banner";
import type { VendorSummary } from "@/lib/types";
import type { ErrorDebug } from "@/lib/errors/types";
import { createPOAction } from "@/lib/purchase-orders/actions";

interface Props {
  vendors: VendorSummary[];
}

export function NewPOForm({ vendors }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<{
    detail: string;
    code?: string;
    debug?: ErrorDebug;
  } | null>(null);

  const [vendorId, setVendorId] = useState("");
  const [currency, setCurrency] = useState("GBP");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [notes, setNotes] = useState("");

  const approvedVendors = useMemo(
    () => vendors.filter((v) => v.approval_status === "approved" && v.is_active),
    [vendors],
  );

  const selectedVendor = approvedVendors.find(
    (v) => String(v.id) === vendorId,
  );

  function onPickVendor(id: string) {
    setVendorId(id);
    const v = approvedVendors.find((x) => String(x.id) === id);
    if (v) setCurrency(v.currency_code);
  }

  function onSubmit() {
    if (!vendorId) return;
    setError(null);
    startTransition(async () => {
      const res = await createPOAction({
        vendor_id: Number(vendorId),
        currency_code: currency,
        expected_delivery_date: deliveryDate || null,
        delivery_address: deliveryAddress.trim() || null,
        notes: notes.trim() || null,
      });
      if (res.ok) {
        router.push(`/procurement/purchase-orders/${res.po.uuid}`);
      } else {
        setError({ detail: res.detail, code: res.code, debug: res.debug });
      }
    });
  }

  return (
    <section className="space-y-4 rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      {error && (
        <ErrorBanner
          detail={error.detail}
          code={error.code}
          debug={error.debug}
        />
      )}

      <div className="space-y-1.5">
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Vendor
        </Label>
        <Select value={vendorId} onValueChange={onPickVendor}>
          <SelectTrigger className="h-10">
            <SelectValue placeholder="Pick an approved vendor…" />
          </SelectTrigger>
          <SelectContent>
            {approvedVendors.length === 0 ? (
              <SelectItem value="__empty__" disabled>
                No approved vendors. Approve one first.
              </SelectItem>
            ) : (
              approvedVendors.map((v) => (
                <SelectItem key={v.id} value={String(v.id)}>
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {v.code ?? `#${v.id}`}
                    </span>
                    <span>{v.name}</span>
                  </span>
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
        {selectedVendor && (
          <p className="text-[11px] text-muted-foreground">
            Default lead time: {selectedVendor.default_lead_time_days} days ·
            currency {selectedVendor.currency_code}
          </p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Currency
          </Label>
          <Input
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            maxLength={3}
            className="font-mono"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Expected delivery
          </Label>
          <Input
            type="date"
            value={deliveryDate}
            onChange={(e) => setDeliveryDate(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Delivery address
        </Label>
        <Textarea
          rows={2}
          value={deliveryAddress}
          onChange={(e) => setDeliveryAddress(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Notes
        </Label>
        <Textarea
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      <div className="flex justify-end">
        <Button onClick={onSubmit} disabled={pending || !vendorId}>
          {pending ? (
            <Loader2 className="mr-1.5 size-4 animate-spin" />
          ) : (
            <Save className="mr-1.5 size-4" />
          )}
          Create draft PO
        </Button>
      </div>
    </section>
  );
}
