import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  BarChart3,
  CalendarClock,
  Gift,
  HandCoins,
  PackageCheck,
  Receipt,
  ShoppingBag,
  Tags,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { listCustomersPage } from "@/lib/customers/server";
import { listPricelistsPage } from "@/lib/pricelists/server";
import { SalesSubnav } from "./sales-subnav";

export const metadata = { title: "Sales · PSP" };

/**
 * Sales overview — the landing page for the module. Today it shows
 * a launcher for what's live (Customers + Pricelists) plus a
 * roadmap of the rest of the MRPEasy-parity tabs. Counts come from
 * the same server fetchers the list pages use, so this is just a
 * skinny dashboard, not its own data model.
 */
export default async function SalesOverviewPage() {
  const user = await requireUser();
  if (!hasPermission(user, "customers.view")) {
    redirect("/settings/profile");
  }

  // Lightweight stat fetches — both already return paginated bundles
  // so we just read .items.length for the on-page counter. If a real
  // count surface lands later, swap to a dedicated endpoint.
  const [customerPage, pricelistPage] = await Promise.all([
    listCustomersPage(),
    listPricelistsPage(),
  ]);

  const customerCount = customerPage?.items.length ?? 0;
  const pricelistCount = pricelistPage?.items.length ?? 0;
  const approvedCustomerCount =
    customerPage?.items.filter((c) => c.effective_approval_status === "approved")
      .length ?? 0;
  const defaultPricelist = pricelistPage?.items.find((p) => p.is_default);

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <SalesSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-7xl space-y-8">
          <header className="space-y-1.5">
            <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              <HandCoins className="size-7 text-brand sm:size-8" />
              Sales
            </h1>
            <p className="max-w-3xl text-sm text-muted-foreground sm:text-base">
              The sell-side of PSP. Customers and pricelists are live;
              the rest of the workflow (orders, invoices, returns, cash
              flow, statistics) is being built in dependency order so
              each module unlocks the next.
            </p>
          </header>

          {/* Live modules */}
          <section className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Live
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <LiveTile
                href="/sales/customers"
                Icon={Users}
                title="Customers"
                description="Sell-side counterparty registry. KYC + Credit + AML + Contract onboarding, 4-eyes approval, annual re-qualification."
                stats={[
                  { label: "Total", value: customerCount },
                  { label: "Approved", value: approvedCustomerCount },
                ]}
              />
              <LiveTile
                href="/sales/pricelists"
                Icon={Tags}
                title="Pricelists"
                description="Tiered selling prices per (item × min-qty). Each customer points at one; a company default catches the rest."
                stats={[
                  { label: "Total", value: pricelistCount },
                  {
                    label: "Default",
                    value: defaultPricelist?.name ?? "—",
                  },
                ]}
              />
            </div>
          </section>

          {/* Roadmap */}
          <section className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Coming next (build order)
            </h2>
            <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <RoadmapTile
                step={1}
                Icon={ShoppingBag}
                title="Customer orders"
                description="Mirror of POs. Draft → confirmed → picked → shipped → invoiced. Reads pricelists + approval gate."
              />
              <RoadmapTile
                step={2}
                Icon={Receipt}
                title="Invoices"
                description="Sell-side invoicing tied to CO lines. Three-way match parity with the procurement side."
              />
              <RoadmapTile
                step={3}
                Icon={PackageCheck}
                title="Returns (RMAs)"
                description="Customer-side returns against shipped orders. Mirrors the vendor-return shape."
              />
              <RoadmapTile
                step={4}
                Icon={CalendarClock}
                title="Today's contacts"
                description="Daily call/email queue — feeds off the customer contact-event log already in place."
              />
              <RoadmapTile
                step={5}
                Icon={Wallet}
                title="Cash flow forecast"
                description="Union of A/P + A/R using payment-terms basis already captured per vendor + customer."
              />
              <RoadmapTile
                step={6}
                Icon={BarChart3}
                title="Statistics"
                description="Sales analytics — by customer, by product, by salesperson."
              />
              <RoadmapTile
                step={7}
                Icon={TrendingUp}
                title="Sales management"
                description="Pipeline / leads / opportunities — the upstream of customer onboarding."
              />
              <RoadmapTile
                step={8}
                Icon={Gift}
                title="Loyalty"
                description="Customer-loyalty / referral surface. The last MRPEasy-parity tab."
              />
            </ol>
          </section>
        </div>
      </main>
    </div>
  );
}

function LiveTile({
  href,
  Icon,
  title,
  description,
  stats,
}: {
  href: string;
  Icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  stats: Array<{ label: string; value: number | string }>;
}) {
  return (
    <Link
      href={href}
      className="group rounded-lg border border-border/60 bg-card p-5 shadow-sm transition-colors hover:border-foreground/30 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon className="size-5 text-brand" />
          <h3 className="text-base font-semibold">{title}</h3>
        </div>
        <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{description}</p>
      <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
        {stats.map((s) => (
          <div key={s.label}>
            <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {s.label}
            </dt>
            <dd className="font-mono text-sm font-semibold">{s.value}</dd>
          </div>
        ))}
      </dl>
    </Link>
  );
}

function RoadmapTile({
  step,
  Icon,
  title,
  description,
}: {
  step: number;
  Icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <li className="rounded-md border border-border/40 bg-muted/30 p-3">
      <div className="flex items-center gap-2">
        <span className="inline-flex size-5 items-center justify-center rounded-full bg-muted font-mono text-[10px] font-semibold text-muted-foreground">
          {step}
        </span>
        <Icon className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
      </div>
      <p className="mt-1.5 pl-7 text-[11px] text-muted-foreground/80">
        {description}
      </p>
    </li>
  );
}
