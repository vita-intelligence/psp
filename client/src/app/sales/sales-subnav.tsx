"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  CalendarClock,
  Gift,
  Home,
  PackageCheck,
  Receipt,
  ShoppingBag,
  Tags,
  TrendingUp,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface SubnavItem {
  href: string;
  label: string;
  Icon: LucideIcon;
  /** Dim non-link with a muted tooltip until the subpage lands. */
  comingSoon?: boolean;
}

/**
 * Sales subnav. Customers ships first; the rest of the MRPEasy-parity
 * tabs (Orders, Invoices, Pricelists, Statistics, Cash flow, Sales
 * management, RMAs, Today's contacts) appear as muted "coming soon"
 * placeholders so the operator can see the planned shape.
 */
const ITEMS: SubnavItem[] = [
  { href: "/sales", label: "Overview", Icon: Home },
  { href: "/sales/customers", label: "Customers", Icon: Users },
  {
    href: "/sales/orders",
    label: "Customer orders",
    Icon: ShoppingBag,
  },
  {
    href: "/sales/todays-contacts",
    label: "Today's contacts",
    Icon: CalendarClock,
  },
  {
    href: "/sales/invoices",
    label: "Invoices",
    Icon: Receipt,
  },
  {
    href: "/sales/pricelists",
    label: "Pricelists",
    Icon: Tags,
  },
  {
    href: "/sales/cash-flow",
    label: "Cash flow",
    Icon: Wallet,
  },
  {
    href: "/sales/statistics",
    label: "Statistics",
    Icon: BarChart3,
  },
  {
    href: "/sales/sales-management",
    label: "Sales management",
    Icon: TrendingUp,
    comingSoon: true,
  },
  {
    href: "/sales/returns",
    label: "Returns (RMAs)",
    Icon: PackageCheck,
  },
  // Mirroring MRPEasy's last icon (the small gift); reserved for the
  // customer-loyalty / referral surface we'll build last.
  {
    href: "/sales/loyalty",
    label: "Loyalty",
    Icon: Gift,
    comingSoon: true,
  },
];

export function SalesSubnav() {
  const pathname = usePathname();

  function isActive(href: string): boolean {
    // Overview is /sales exactly — without this special case it would
    // match /sales/customers, /sales/pricelists, etc.
    if (href === "/sales") return pathname === "/sales";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <nav
      aria-label="Sales sections"
      className="sticky top-16 z-[5] border-b border-border/60 bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60"
    >
      <div className="mx-auto grid max-w-7xl grid-cols-3 gap-1 px-4 py-2 sm:grid-cols-6 sm:px-8 lg:grid-cols-11">
        {ITEMS.map((item) => {
          const active = isActive(item.href);

          if (item.comingSoon) {
            return (
              <span
                key={item.href}
                className="inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground/50"
                title={`${item.label} — coming soon`}
              >
                <item.Icon className="size-3.5 shrink-0" />
                <span className="truncate">{item.label}</span>
              </span>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}
            >
              <item.Icon className="size-3.5 shrink-0" />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
