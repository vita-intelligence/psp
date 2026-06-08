"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeftRight,
  Boxes,
  Home,
  Layers,
  PackageMinus,
  ScrollText,
  Send,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface SubnavItem {
  href: string;
  label: string;
  Icon: LucideIcon;
  /** When true, render as a dim non-link with a "Soon" badge.
   *  Drop this flag as each subpage lands so the nav lights up
   *  incrementally. */
  comingSoon?: boolean;
}

const ITEMS: SubnavItem[] = [
  { href: "/stock", label: "Overview", Icon: Home },
  { href: "/stock/lots", label: "Lots", Icon: Layers },
  { href: "/stock/inventory", label: "Inventory", Icon: Boxes, comingSoon: true },
  {
    href: "/stock/movements",
    label: "Movements",
    Icon: ArrowLeftRight,
    comingSoon: true,
  },
  {
    href: "/stock/critical-on-hand",
    label: "Critical",
    Icon: AlertTriangle,
    comingSoon: true,
  },
  {
    href: "/stock/write-offs",
    label: "Write-offs",
    Icon: PackageMinus,
    comingSoon: true,
  },
  { href: "/stock/shipments", label: "Shipments", Icon: Send, comingSoon: true },
  {
    href: "/stock/transfer-orders",
    label: "Transfers",
    Icon: Truck,
    comingSoon: true,
  },
  {
    href: "/stock/statistics",
    label: "Statistics",
    Icon: ScrollText,
    comingSoon: true,
  },
];

/**
 * Sticky subnav rendered on every /stock/* page. Lets the operator
 * jump between Lots / Inventory / Movements without bouncing back
 * to the hub.
 *
 * Active route uses the full pathname match for "/stock" (so the
 * Overview chip lights only on the hub), and a prefix match for
 * every other entry (so /stock/lots/abc-uuid still highlights Lots).
 */
export function StockSubnav() {
  const pathname = usePathname();

  function isActive(href: string): boolean {
    if (href === "/stock") return pathname === "/stock";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <nav
      aria-label="Stock sections"
      className="sticky top-16 z-[5] border-b border-border/60 bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60"
    >
      <div className="mx-auto grid max-w-7xl grid-cols-3 gap-1 px-4 py-2 sm:grid-cols-5 sm:px-8 lg:grid-cols-9">
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
