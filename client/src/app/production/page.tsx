import Link from "next/link";
import { redirect } from "next/navigation";
import {
  CalendarDays,
  ClipboardCheck,
  Factory,
  ListChecks,
  Microscope,
  Network,
  Play,
  Route,
  Settings2,
  Shield,
  ShieldCheck,
  TrendingUp,
  Workflow,
} from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PageHeader } from "@/components/layout/page-header";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { ProductionSubnav } from "./production-subnav";

export const metadata = { title: "Production · PSP" };

interface ProdSection {
  href: string;
  label: string;
  description: string;
  Icon: typeof Factory;
  /** Dim style + caption — subtabs land slice-by-slice. */
  comingSoon?: boolean;
}

const SECTIONS: ProdSection[] = [
  {
    href: "/production/manufacturing-orders",
    label: "Manufacturing orders",
    description:
      "Open MOs, their status, consumed stock, and yield. Drives the floor schedule.",
    Icon: Factory,
  },
  {
    href: "/production/approvals",
    label: "Approvals",
    description:
      "MOs awaiting the 2nd signature — preparer + countersigner shows here, oldest first. Two different holders of `production.mo_approve` required.",
    Icon: Shield,
  },
  {
    href: "/production/schedule",
    label: "Production schedule",
    description:
      "Calendar view of every MO across workstations and groups. Drag to re-plan.",
    Icon: CalendarDays,
  },
  {
    href: "/production/preflight",
    label: "Pre-production",
    description:
      "Verify ingredient qty + quality after warehouse pickup. Each MO must be signed off line-by-line before it can flip to In progress.",
    Icon: ClipboardCheck,
  },
  {
    href: "/production/runs",
    label: "Production runs",
    description:
      "Start + finish active MOs. Captures actual start / finish times + produced quantity, and auto-creates the output stock lot.",
    Icon: Play,
  },
  {
    href: "/production/output-qc",
    label: "Output QC",
    description:
      "Pass / fail manufactured output lots. Until cleared, output stays in `received` status and can't be transferred to the warehouse.",
    Icon: Microscope,
  },
  {
    href: "/production/final-releases",
    label: "Final release",
    description:
      "QA sign-off on finished product before dispatch — dual signature + CoA / BMR / micro / label proof (BRCGS Issue 9 § 5.6 Positive Release).",
    Icon: ShieldCheck,
  },
  {
    href: "/production/mps",
    label: "MPS",
    description:
      "Master Production Schedule — demand vs. capacity rolled up by product family and week.",
    Icon: TrendingUp,
    comingSoon: true,
  },
  {
    href: "/production/workstations",
    label: "Workstations",
    description:
      "Physical machines + their capacity, calendar, and downtime.",
    Icon: Settings2,
  },
  {
    href: "/production/workstation-groups",
    label: "Workstation groups",
    description:
      "Group interchangeable workstations so a routing step can land on whichever is free.",
    Icon: Network,
  },
  {
    href: "/production/boms",
    label: "BOM",
    description:
      "Bill of Materials per finished good — parts, quantities, primary recipe. Toggle per product family under Settings → Catalogue.",
    Icon: ListChecks,
  },
  {
    href: "/production/routings",
    label: "Routings",
    description:
      "Operations + setup times per BOM. The schedule reads off these.",
    Icon: Route,
  },
  {
    href: "/production/statistics",
    label: "Statistics",
    description:
      "Throughput, OEE, scrap, on-time MO close rate. Sliced by item, workstation, week.",
    Icon: Workflow,
    comingSoon: true,
  },
];

export default async function ProductionHomePage() {
  const user = await requireUser();
  if (!hasPermission(user, "production.bom_view")) {
    redirect("/settings/profile");
  }

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <ProductionSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-6xl space-y-8">
          <PageHeader
            icon={Factory}
            title="Production"
            description="Bills of Materials, manufacturing orders, the schedule, and the workstations they run on. Slices ship one at a time — BOM first."
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
