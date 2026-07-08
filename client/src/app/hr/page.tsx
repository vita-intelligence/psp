import Link from "next/link";
import { redirect } from "next/navigation";
import {
    Award,
    CalendarDays,
    Coins,
    TrendingUp,
    Users2,
} from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { PageHeader } from "@/components/layout/page-header";

export const metadata = { title: "HR · PSP" };

interface HRSection {
    href: string;
    label: string;
    description: string;
    Icon: typeof Users2;
    /** Dim + caption for slices that haven't landed yet — matches the
     *  Procurement overview pattern so operators recognise the state. */
    comingSoon?: boolean;
}

const SECTIONS: HRSection[] = [
    {
        href: "/hr/employees",
        label: "Employees",
        description:
            "Master data for the shop-floor workforce. Identity, kiosk PIN, wage-history timeline, and reputation events. Sessions FK the record so archive is soft-delete.",
        Icon: Users2,
    },
    {
        href: "/hr/wages",
        label: "Wages",
        description:
            "Point-in-time wage lookup across every employee. Powers the MO cost breakdown's labour column — wages resolve at session start, not now.",
        Icon: Coins,
        comingSoon: true,
    },
    {
        href: "/hr/reputation",
        label: "Reputation",
        description:
            "Per-employee reputation score with 180-day linear decay. Positive events lift, negative events dock; the score is a projection of the underlying event stream.",
        Icon: Award,
        comingSoon: true,
    },
    {
        href: "/hr/shifts",
        label: "Shifts",
        description:
            "Planned attendance windows per employee. Cross-references kiosk sessions so absent-when-scheduled becomes a first-class metric.",
        Icon: CalendarDays,
        comingSoon: true,
    },
    {
        href: "/hr/statistics",
        label: "Statistics",
        description:
            "Overtime hours, average performance %, session count by employee, wage-run totals per period.",
        Icon: TrendingUp,
        comingSoon: true,
    },
];

export default async function HRHomePage() {
    const user = await requireUser();
    if (!hasPermission(user, "hr.view")) {
        redirect("/");
    }

    return (
        <div className="space-y-8">
            <PageHeader
                icon={Users2}
                title="HR"
                description="Employees, wages, and reputation for the shop-floor workforce. Slices ship one at a time — Employees first."
            />

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
                                    <h2 className="text-sm font-semibold">
                                        {s.label}
                                    </h2>
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
                        <Link
                            key={s.href}
                            href={s.href}
                            className={className}
                        >
                            {content}
                        </Link>
                    );
                })}
            </div>
        </div>
    );
}
