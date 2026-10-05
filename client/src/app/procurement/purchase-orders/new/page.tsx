import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ShoppingCart } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { ProcurementSubnav } from "../../procurement-subnav";
import { NewPOForm } from "./new-po-form";

export const metadata = { title: "New PO · Procurement · PSP" };

interface SearchParams {
  item_uuid?: string;
  qty?: string;
  /** Numeric vendor id — the my-tasks reorder task and the shortages
   *  page can both pre-select the last-known supplier so the buyer
   *  doesn't retype it. Nullable — form falls back to the vendor
   *  picker when absent. */
  vendor_id?: string;
  /** ``1`` when the shortages page linked us from an R&D row. Pre-
   *  ticks the ``For R&D`` checkbox so the resulting PO's lots
   *  inherit ``is_rnd = true``. */
  is_rnd?: string;
  /** Base64-URL-encoded JSON array of ``{item_uuid, qty}``. Shortages
   *  → "Create PO for this vendor" cluster action deep-links here so
   *  every short item for the chosen vendor seeds the form in one
   *  shot. Keeps the single-item ``item_uuid`` + ``qty`` prefill in
   *  place for backwards compat with the per-row Create PO button
   *  and the my-tasks reorder link. */
  prefill?: string;
}

export default async function NewPOPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireUser();
  if (!hasPermission(user, "procurement.po_create")) {
    redirect("/procurement/purchase-orders");
  }

  // Deep-link prefill from the shortages page + my-tasks reorder
  // tasks — read on the server so the form mounts with the prefill
  // in its initial state, no post-mount fetch + insert dance required.
  const { item_uuid, qty, vendor_id, is_rnd, prefill } = await searchParams;

  // Decode the bulk-prefill blob. Base64url over JSON keeps the URL
  // compact for a vendor cluster of ~10-20 lines (well under any
  // browser or CDN URL cap) while still being plain text — a buyer
  // can eyeball the decoded array in DevTools before submitting.
  const prefillLines: Array<{ item_uuid: string; qty: string | null }> | null =
    (() => {
      if (!prefill) return null;
      try {
        const padded = prefill.replace(/-/g, "+").replace(/_/g, "/");
        const padLen = (4 - (padded.length % 4)) % 4;
        const decoded = Buffer.from(
          padded + "=".repeat(padLen),
          "base64",
        ).toString("utf-8");
        const parsed = JSON.parse(decoded);
        if (!Array.isArray(parsed)) return null;
        const clean = parsed
          .filter(
            (r): r is { item_uuid: string; qty?: string | null } =>
              r &&
              typeof r === "object" &&
              typeof r.item_uuid === "string",
          )
          .map((r) => ({ item_uuid: r.item_uuid, qty: r.qty ?? null }));
        return clean.length > 0 ? clean : null;
      } catch {
        return null;
      }
    })();

  // Eager vendor + item + warehouse fetches dropped — the form's
  // pickers hit /api/vendors?search&limit=50 etc. on demand, so the
  // page paints instantly regardless of catalogue size and we don't
  // ship a megabyte of vendor rows on every PO open.

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <ProcurementSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-10">
        <div className="mx-auto w-full space-y-6">
          <div>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
            >
              <Link href="/procurement/purchase-orders">
                <ChevronLeft className="mr-1 size-4" />
                Back to POs
              </Link>
            </Button>
          </div>

          <header className="space-y-1.5">
            <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight sm:text-3xl">
              <ShoppingCart className="size-6 text-brand sm:size-7" />
              New purchase order
            </h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              Pick a vendor + items, add the supplier paperwork, save as
              a draft. Submit it for approval when ready — two-tier ESIGN
              signs it off, then the PO transitions to ordered and the
              system reserves the expected stock automatically.
            </p>
          </header>

          <NewPOForm
            prefillItemUuid={item_uuid ?? null}
            prefillQty={qty ?? null}
            prefillVendorId={vendor_id ?? null}
            prefillIsRnd={is_rnd === "1" || is_rnd === "true"}
            prefillLines={prefillLines}
          />
        </div>
      </main>
    </div>
  );
}
