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
import { PageHeader } from "@/components/layout/page-header";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { getCompanyDefaults } from "@/lib/company/server";
import { listCustomersPage } from "@/lib/customers/server";
import { listPricelistsPage } from "@/lib/pricelists/server";
import { listCustomerOrdersPage } from "@/lib/customer-orders/server";
import { listCustomerInvoicesPage } from "@/lib/customer-invoices/server";
import { listCustomerReturnsPage } from "@/lib/customer-returns/server";
import { formatCompanyMoney } from "@/lib/format/company";
import { SalesSubnav } from "./sales-subnav";

export const metadata = { title: "Sales · PSP" };
export const dynamic = "force-dynamic";

/**
 * Sales overview — the landing page for the /sales module. KPI strip
 * up top, module launcher grid below. Counts come from the same
 * server fetchers each list page uses; this is a skinny dashboard,
 * not its own data model. Every tile is permission-gated so an
 * operator without the perm sees the tile disabled (with a hint)
 * rather than a broken link.
 */
export default async function SalesOverviewPage() {
  const user = await requireUser();
  if (!hasPermission(user, "customers.view")) {
    redirect("/settings/profile");
  }

  const [
    customers,
    pricelists,
    orders,
    invoices,
    returns,
    company,
  ] = await Promise.all([
    listCustomersPage(),
    listPricelistsPage(),
    listCustomerOrdersPage(),
    listCustomerInvoicesPage(),
    listCustomerReturnsPage(),
    getCompanyDefaults(),
  ]);

  const customerCount = customers?.items.length ?? 0;
  const approvedCustomerCount =
    customers?.items.filter((c) => c.effective_approval_status === "approved")
      .length ?? 0;

  const pricelistCount = pricelists?.items.length ?? 0;
  const defaultPricelist = pricelists?.items.find((p) => p.is_default);

  const orderCount = orders?.items.length ?? 0;
  const activeOrderCount =
    orders?.items.filter(
      (o) => o.status !== "cancelled" && o.status !== "confirmed",
    ).length ?? 0;

  const invoiceCount = invoices?.items.length ?? 0;
  const outstandingInvoices =
    invoices?.items.filter(
      (i) => i.status !== "cancelled" && i.status !== "paid",
    ) ?? [];
  const outstandingTotal = outstandingInvoices.reduce((sum, i) => {
    const grand = Number(i.grand_total ?? 0);
    const paid = Number(i.paid_amount ?? 0);
    return sum + Math.max(grand - paid, 0);
  }, 0);

  const returnCount = returns?.items.length ?? 0;
  const openReturnCount =
    returns?.items.filter(
      (r) =>
        r.status !== "accepted" &&
        r.status !== "rejected" &&
        r.status !== "cancelled",
    ).length ?? 0;

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <SalesSubnav />

      <main className="flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-6xl space-y-8">
          <PageHeader
            icon={HandCoins}
            title="Sales"
            description="The sell-side of PSP — customers, orders, invoices, returns, and the analytics + admin tools around them."
          />

          {/* KPI strip */}
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Active orders"
              value={String(activeOrderCount)}
              hint={`${orderCount} total on file`}
              href={hasPermission(user, "customer_orders.view") ? "/sales/orders" : null}
              Icon={ShoppingBag}
            />
            <KpiCard
              label="Outstanding invoices"
              value={
                outstandingInvoices.length > 0
                  ? formatCompanyMoney(String(outstandingTotal), company)
                  : "—"
              }
              hint={`${outstandingInvoices.length} unpaid · ${invoiceCount} total`}
              href={hasPermission(user, "customer_invoices.view") ? "/sales/invoices" : null}
              Icon={Receipt}
            />
            <KpiCard
              label="Open returns"
              value={String(openReturnCount)}
              hint={`${returnCount} total on file`}
              href={hasPermission(user, "customer_returns.view") ? "/sales/returns" : null}
              Icon={PackageCheck}
            />
            <KpiCard
              label="Approved customers"
              value={`${approvedCustomerCount} / ${customerCount}`}
              hint="Only approved customers can back a CO"
              href={hasPermission(user, "customers.view") ? "/sales/customers" : null}
              Icon={Users}
            />
          </section>

          {/* Module launcher */}
          <section className="space-y-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Modules
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <ModuleTile
                href="/sales/customers"
                Icon={Users}
                title="Customers"
                description="KYC + Credit + AML + Contract onboarding, 4-eyes approval, annual re-qualification."
                stat={`${customerCount} on file`}
                gated={hasPermission(user, "customers.view")}
              />
              <ModuleTile
                href="/sales/orders"
                Icon={ShoppingBag}
                title="Customer orders"
                description="Draft → confirmed → dispatched → delivered. Reads pricelists + two-tier approval gate."
                stat={`${activeOrderCount} active`}
                gated={hasPermission(user, "customer_orders.view")}
              />
              <ModuleTile
                href="/sales/invoices"
                Icon={Receipt}
                title="Invoices"
                description="Sell-side invoicing with per-line VAT + payment terms."
                stat={`${outstandingInvoices.length} unpaid`}
                gated={hasPermission(user, "customer_invoices.view")}
              />
              <ModuleTile
                href="/sales/returns"
                Icon={PackageCheck}
                title="Returns (RMAs)"
                description="Customer-side returns against shipped orders — draft → received → resolved."
                stat={`${openReturnCount} open`}
                gated={hasPermission(user, "customer_returns.view")}
              />
              <ModuleTile
                href="/sales/pricelists"
                Icon={Tags}
                title="Pricelists"
                description="Tiered selling prices per (item × min-qty). Company default catches uncustomised customers."
                stat={
                  defaultPricelist
                    ? `${pricelistCount} · default: ${defaultPricelist.name}`
                    : `${pricelistCount}`
                }
                gated={hasPermission(user, "pricelists.view")}
              />
              <ModuleTile
                href="/sales/todays-contacts"
                Icon={CalendarClock}
                title="Today's contacts"
                description="Daily call / email queue driven by the customer contact-frequency schedule."
                gated={hasPermission(user, "customers.view")}
              />
              <ModuleTile
                href="/sales/cash-flow"
                Icon={Wallet}
                title="Cash flow"
                description="A/P + A/R forecast using payment-terms basis from each vendor + customer."
                gated={hasPermission(user, "customer_invoices.view")}
              />
              <ModuleTile
                href="/sales/statistics"
                Icon={BarChart3}
                title="Statistics"
                description="Sales analytics — by customer, item, and salesperson."
                gated={hasPermission(user, "customers.view")}
              />
              <ModuleTile
                href="/sales/sales-management"
                Icon={TrendingUp}
                title="Sales management"
                description="Pipeline / leads / opportunities — the upstream of customer onboarding."
                gated={hasPermission(user, "customers.view")}
              />
              <ModuleTile
                href="/sales/loyalty"
                Icon={Gift}
                title="Loyalty"
                description="Programs, tiers, and per-customer point balances."
                gated={hasPermission(user, "customers.view")}
              />
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
  href,
  Icon,
}: {
  label: string;
  value: string;
  hint: string;
  href: string | null;
  Icon: React.ComponentType<{ className?: string }>;
}) {
  const inner = (
    <div className="flex h-full flex-col rounded-lg border border-border/60 bg-card p-4 shadow-sm transition-colors group-hover:border-foreground/30">
      <div className="flex items-center justify-between text-muted-foreground">
        <span className="text-[10px] font-semibold uppercase tracking-wider">
          {label}
        </span>
        <Icon className="size-3.5" />
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );

  if (!href) {
    return <div className="group">{inner}</div>;
  }

  return (
    <Link href={href} className="group block">
      {inner}
    </Link>
  );
}

function ModuleTile({
  href,
  Icon,
  title,
  description,
  stat,
  gated,
}: {
  href: string;
  Icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  stat?: string;
  gated: boolean;
}) {
  const body = (
    <div className="flex h-full flex-col gap-2 rounded-lg border border-border/60 bg-card p-4 shadow-sm transition-colors group-hover:border-foreground/30">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-brand" />
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
        {gated && (
          <ArrowRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        )}
      </div>
      <p className="text-xs text-muted-foreground line-clamp-3">{description}</p>
      <div className="mt-auto pt-1">
        {stat ? (
          <span className="font-mono text-[11px] font-semibold text-foreground/80">
            {stat}
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground/70">Open →</span>
        )}
      </div>
    </div>
  );

  if (!gated) {
    return (
      <div
        className="group cursor-not-allowed opacity-50"
        title="You don't have permission for this module."
      >
        {body}
      </div>
    );
  }

  return (
    <Link href={href} className="group block">
      {body}
    </Link>
  );
}
