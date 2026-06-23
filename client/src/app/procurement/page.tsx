import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ClipboardCheck,
  FileText,
  Microscope,
  Receipt,
  ShoppingCart,
  TrendingUp,
  Users,
} from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { ProcurementSubnav } from "./procurement-subnav";

export const metadata = { title: "Procurement · PSP" };

interface ProcSection {
  href: string;
  label: string;
  description: string;
  Icon: typeof ShoppingCart;
  /** Dim style + caption — subtabs land slice-by-slice. */
  comingSoon?: boolean;
}

const SECTIONS: ProcSection[] = [
  {
    href: "/procurement/vendors",
    label: "Vendors",
    description:
      "Approved-supplier registry. Risk class, qualification status, certificates, per-item approval list.",
    Icon: Users,
  },
  {
    href: "/procurement/purchase-orders",
    label: "Purchase orders",
    description:
      "Raise + approve POs against approved vendors. Two-tier ESIGN sign-off; receive against PO from the detail page.",
    Icon: ShoppingCart,
  },
  {
    href: "/procurement/invoices",
    label: "Invoices",
    description:
      "Vendor invoices linked to POs. AP ledger with multi-currency totals, due-date tracking, and payment status.",
    Icon: Receipt,
  },
  {
    href: "/procurement/shortages",
    label: "Shortages",
    description:
      "What needs ordering next — raw-material and packaging items still short across open MOs after subtracting bookings and qty on open POs.",
    Icon: FileText,
  },
  {
    href: "/procurement/inspections",
    label: "Inspections",
    description:
      "Goods-in inspections against POs. 8-section checklist + dual ESIGN.",
    Icon: Microscope,
  },
  {
    href: "/procurement/critical-on-hand",
    label: "Critical",
    description:
      "Items below safety stock or with a vendor lead time longer than current cover.",
    Icon: ClipboardCheck,
    comingSoon: true,
  },
  {
    href: "/procurement/statistics",
    label: "Statistics",
    description:
      "Spend by vendor, on-time delivery, lead-time variance, top-spend items.",
    Icon: TrendingUp,
    comingSoon: true,
  },
];

export default async function ProcurementHomePage() {
  const user = await requireUser();
  if (!hasPermission(user, "vendors.view")) {
    redirect("/settings/profile");
  }

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <ProcurementSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-6xl space-y-8">
          <header className="space-y-1.5">
            <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              <ShoppingCart className="size-7 text-brand sm:size-8" />
              Procurement
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
              Vendor qualification, purchase orders, invoices, and the
              receipts they create. Slices ship one at a time —
              Vendors first.
            </p>
          </header>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {SECTIONS.map((s) => {
              const className = s.comingSoon
                ? "block rounded-lg border border-dashed border-border/60 bg-muted/30 p-4 opacity-70"
                : "block rounded-lg border border-border/60 bg-card p-4 transition-colors hover:border-foreground/30 hover:bg-muted/30";

              const content = (
                <div className="flex items-start gap-3">
                  <s.Icon className="mt-0.5 size-5 text-muted-foreground" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-semibold">{s.label}</h2>
                      {s.comingSoon && (
                        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Coming soon
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {s.description}
                    </p>
                  </div>
                </div>
              );

              return s.comingSoon ? (
                <div
                  key={s.href}
                  className={className}
                  title={`${s.label} — coming soon`}
                >
                  {content}
                </div>
              ) : (
                <Link key={s.href} href={s.href} className={className}>
                  {content}
                </Link>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
}
