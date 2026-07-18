import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, FilePlus } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PageHeader } from "@/components/layout/page-header";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { StockSubnav } from "../../stock-subnav";
import { ReceiveForm } from "./receive-form";

export const metadata = { title: "Create manual lot · PSP" };

export default async function ReceiveLotPage() {
  const user = await requireUser();
  if (!hasPermission(user, "stock.receive")) {
    redirect("/stock/lots");
  }

  // Eager item + warehouse fetches dropped — the form's pickers hit
  // `/api/items?search=…&limit=50` and `/api/warehouses?search=…&limit=50`
  // on demand, so the page paints instantly regardless of catalogue
  // size. Empty-catalogue UX surfaces via the picker's "no matches"
  // hint, which links to /production/items.
  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <StockSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-4xl space-y-6">
          <Link
            href="/stock/lots"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Back to stock lots
          </Link>

          <PageHeader
            icon={FilePlus}
            title="Create manual lot"
            description={
              <>
                For ad-hoc entries — opening balances, adjustments,
                anything that didn&apos;t come through a Purchase Order.
                Real PO receives will land here from the Procurement
                module once it ships. Source is recorded as{" "}
                <span className="font-mono">manual</span>, with your name
                + timestamp on the audit trail.
              </>
            }
          />

          <ReceiveForm canEdit={true} />
        </div>
      </main>
    </div>
  );
}
