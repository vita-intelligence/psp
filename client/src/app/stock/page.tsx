import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeftRight,
  Boxes,
  Clock,
  Layers,
  PackageMinus,
  ScrollText,
  Send,
  Truck,
} from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PageHeader } from "@/components/layout/page-header";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { StockSubnav } from "./stock-subnav";

export const metadata = { title: "Stock · PSP" };

interface StockSection {
  href: string;
  label: string;
  description: string;
  Icon: typeof Boxes;
  /** Shows the dim style + a "Coming soon" caption. Subtabs land in
   *  slices; we keep the page navigable while the rest builds out. */
  comingSoon?: boolean;
}

const SECTIONS: StockSection[] = [
  {
    href: "/stock/lots",
    label: "Stock lots",
    description:
      "Every receipt as its own immutable lot — supplier batch, expiry, CoA, cost.",
    Icon: Layers,
  },
  {
    href: "/stock/inventory",
    label: "Inventory",
    description: "What's on hand right now, grouped by item and cell.",
    Icon: Boxes,
  },
  {
    href: "/stock/movements",
    label: "Movements",
    description:
      "Audit trail of every receive, move, consume, or adjust across all lots.",
    Icon: ArrowLeftRight,
    comingSoon: true,
  },
  {
    href: "/stock/critical-on-hand",
    label: "Critical on-hand",
    description: "Items below their reorder point — what to buy next.",
    Icon: AlertTriangle,
    comingSoon: true,
  },
  {
    href: "/stock/write-offs",
    label: "Write-offs",
    description: "Disposal and damage records with reason + actor.",
    Icon: PackageMinus,
    comingSoon: true,
  },
  {
    href: "/stock/shipments",
    label: "Shipments",
    description: "Outbound dispatches against sales orders.",
    Icon: Send,
    comingSoon: true,
  },
  {
    href: "/stock/transfer-orders",
    label: "Transfer orders",
    description:
      "Multi-step internal moves: planned → picked → in transit → received.",
    Icon: Truck,
    comingSoon: true,
  },
  {
    href: "/stock/statistics",
    label: "Statistics",
    description: "Turn rate, days-on-hand, stock value.",
    Icon: ScrollText,
    comingSoon: true,
  },
];

export default async function StockPage() {
  const user = await requireUser();
  if (!hasPermission(user, "stock.view")) {
    redirect("/settings/profile");
  }

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <StockSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-6xl space-y-8">
          <PageHeader
            icon={Boxes}
            title="Stock"
            description="Lots, placements, and movements across every warehouse. The first slice (Lots + Receive) is in progress — the rest of the subtabs follow."
          />

          <section className="rounded-lg border border-dashed border-border/60 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <Clock className="size-4" />
              <span>
                We&apos;re building this module. Subtabs marked &quot;coming
                soon&quot; aren&apos;t live yet — they&apos;re the slices
                planned next.
              </span>
            </div>
          </section>

          <section
            aria-label="Stock subtabs"
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          >
            {SECTIONS.map((s) => {
              const body = (
                <>
                  <span
                    className={`inline-flex size-10 shrink-0 items-center justify-center rounded-full ${
                      s.comingSoon
                        ? "bg-muted text-muted-foreground"
                        : "bg-primary/10 text-primary"
                    }`}
                  >
                    <s.Icon className="size-5" />
                  </span>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold tracking-tight">
                        {s.label}
                      </h3>
                      {s.comingSoon && (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          Coming soon
                        </span>
                      )}
                    </div>
                    <p className="text-xs leading-snug text-muted-foreground">
                      {s.description}
                    </p>
                  </div>
                </>
              );

              return s.comingSoon ? (
                <article
                  key={s.href}
                  className="flex items-start gap-3 rounded-lg border border-border/60 bg-card p-4 opacity-70"
                >
                  {body}
                </article>
              ) : (
                <Link
                  key={s.href}
                  href={s.href}
                  className="flex items-start gap-3 rounded-lg border border-border/60 bg-card p-4 transition-colors hover:border-primary/40 hover:bg-card/80"
                >
                  {body}
                </Link>
              );
            })}
          </section>
        </div>
      </main>
    </div>
  );
}
