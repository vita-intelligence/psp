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
import { listHREmployeesFirstPage } from "@/lib/hr/server";
import { listAllShifts } from "@/lib/hr/server";

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

function buildSections(counts: { employees: number | null; runningShifts: number }): HRSection[] {
    return [
        {
            href: "/hr/employees",
            label: "Employees",
            description:
                counts.employees == null
                    ? "Master data for the shop-floor workforce. Identity, kiosk PIN, wage-history timeline, and reputation events."
                    : `${counts.employees} on file. Identity, kiosk PIN, wage-history timeline, and reputation events all live on the employee record.`,
            Icon: Users2,
        },
        {
            href: "/hr/wages",
            label: "Wages",
            description:
                "Company-wide wage timeline. Every rate change writes a new row; the current row (no end date) is what the MO cost breakdown reads at session start.",
            Icon: Coins,
        },
        {
            href: "/hr/reputation",
            label: "Reputation",
            description:
                "Per-employee reputation event log with 180-day linear decay. Positive events lift, negative events dock; the cached score is a projection of the stream.",
            Icon: Award,
        },
        {
            href: "/hr/shifts",
            label: "Shifts",
            description:
                counts.runningShifts > 0
                    ? `${counts.runningShifts} shift${counts.runningShifts === 1 ? "" : "s"} currently open. Kiosk clock-in / clock-out windows synced from vita-performance.`
                    : "Kiosk clock-in / clock-out windows synced from vita-performance. Filter by worker, infinite scroll.",
            Icon: CalendarDays,
        },
        {
            href: "/hr/statistics",
            label: "Statistics",
            description:
                "Aggregate per-worker metrics: shifts logged, hours worked, session count, avg performance %, current rate, and estimated labour cost across a rolling window.",
            Icon: TrendingUp,
        },
    ];
}

export default async function HRHomePage() {
    const user = await requireUser();
    if (!hasPermission(user, "hr.view")) {
        redirect("/");
    }

    // Lightweight counts for the tiles — first page of each is enough
    // for the summary. Failure is silent (fetchers already return null
    // / empty pages) so a transient PSP glitch doesn't blank the
    // landing.
    const [employeesPage, shiftsPage] = await Promise.all([
        listHREmployeesFirstPage(),
        listAllShifts({ limit: 50 }),
    ]);
    const sections = buildSections({
        employees: employeesPage?.items?.length ?? null,
        runningShifts: shiftsPage.items.filter((s) => s.ended_at === null).length,
    });

    return (
        <div className="space-y-8">
            <PageHeader
                icon={Users2}
                title="HR"
                description="Employees, wages, reputation, and kiosk shifts for the shop-floor workforce. Data flows from vita-performance's personal kiosk."
            />

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {sections.map((s) => {
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
                            key={s.label}
                            className={className}
                            title={`${s.label} — coming soon`}
                        >
                            {content}
                        </div>
                    ) : (
                        <Link
                            key={s.label}
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
