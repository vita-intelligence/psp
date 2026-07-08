"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
    Award,
    CalendarDays,
    Coins,
    Home,
    TrendingUp,
    Users2,
    type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface SubnavItem {
    href: string;
    label: string;
    Icon: LucideIcon;
    /** Dim non-link with a muted tooltip until the sub-page lands. */
    comingSoon?: boolean;
}

const ITEMS: SubnavItem[] = [
    { href: "/hr", label: "Overview", Icon: Home },
    { href: "/hr/employees", label: "Employees", Icon: Users2 },
    { href: "/hr/wages", label: "Wages", Icon: Coins, comingSoon: true },
    {
        href: "/hr/reputation",
        label: "Reputation",
        Icon: Award,
        comingSoon: true,
    },
    { href: "/hr/shifts", label: "Shifts", Icon: CalendarDays, comingSoon: true },
    {
        href: "/hr/statistics",
        label: "Statistics",
        Icon: TrendingUp,
        comingSoon: true,
    },
];

/**
 * Sticky subnav rendered on every /hr/* page. Matches
 * ProcurementSubnav's grid + tone tokens so the two modules feel
 * identical to navigate — same tab shape, same active pill, same
 * "coming soon" muted style for slices that haven't landed yet.
 */
export function HRSubnav() {
    const pathname = usePathname();

    function isActive(href: string): boolean {
        if (href === "/hr") return pathname === "/hr";
        return pathname === href || pathname.startsWith(`${href}/`);
    }

    return (
        <nav
            aria-label="HR sections"
            className="sticky top-16 z-[5] border-b border-border/60 bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60"
        >
            <div className="mx-auto grid max-w-7xl grid-cols-3 gap-1 px-4 py-2 sm:grid-cols-4 sm:px-8 lg:grid-cols-6">
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
