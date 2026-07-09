"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Boxes,
  CalendarDays,
  ClipboardCheck,
  Factory,
  Home,
  ListChecks,
  Microscope,
  Network,
  Play,
  Route,
  Settings2,
  ShieldCheck,
  TrendingUp,
  Workflow,
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

// Order mirrors MRPEasy's Production menu. BOM is the only fully
// wired stop today; the rest stub out with a "coming soon" tone so
// the operator sees the planned shape of the module.
const ITEMS: SubnavItem[] = [
  { href: "/production", label: "Overview", Icon: Home },
  {
    href: "/production/manufacturing-orders",
    label: "Manufacturing orders",
    Icon: Factory,
  },
  {
    href: "/production/approvals",
    label: "Approvals",
    Icon: ShieldCheck,
  },
  {
    href: "/production/schedule",
    label: "Production schedule",
    Icon: CalendarDays,
  },
  {
    href: "/production/preflight",
    label: "Pre-production",
    Icon: ClipboardCheck,
  },
  {
    href: "/production/runs",
    label: "Production runs",
    Icon: Play,
  },
  {
    href: "/production/output-qc",
    label: "Output QC",
    Icon: Microscope,
  },
  {
    href: "/production/final-releases",
    label: "Final release",
    Icon: ShieldCheck,
  },
  {
    href: "/production/mps",
    label: "MPS",
    Icon: TrendingUp,
    comingSoon: true,
  },
  {
    href: "/production/workstations",
    label: "Workstations",
    Icon: Settings2,
  },
  {
    href: "/production/workstation-groups",
    label: "Workstation groups",
    Icon: Network,
  },
  {
    href: "/production/machines",
    label: "Machines",
    Icon: Boxes,
  },
  { href: "/production/boms", label: "BOM", Icon: ListChecks },
  {
    href: "/production/routings",
    label: "Routings",
    Icon: Route,
  },
  {
    href: "/production/statistics",
    label: "Statistics",
    Icon: Workflow,
    comingSoon: true,
  },
];

/**
 * Sticky subnav rendered on every /production/* page. Mirrors
 * `ProcurementSubnav` pixel-for-pixel so the modules feel identical
 * to navigate.
 */
export function ProductionSubnav() {
  const pathname = usePathname();

  function isActive(href: string): boolean {
    if (href === "/production") return pathname === "/production";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <nav
      aria-label="Production sections"
      className="sticky top-16 z-[5] border-b border-border/60 bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60"
    >
      <div className="mx-auto grid max-w-7xl grid-cols-3 gap-1 px-4 py-2 sm:grid-cols-4 sm:px-8 lg:grid-cols-12">
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
