import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, ChevronRight, ShieldCheck } from "lucide-react";
import { getSessionToken } from "@/lib/auth/server";
import { getDeviceToken } from "@/lib/devices/server";
import { getFinalReleaseQueue } from "@/lib/production-final-release/server";

export const metadata = { title: "Final Release · PSP Mobile" };
export const dynamic = "force-dynamic";

export default async function MobileFinalReleasePage() {
  const [device, session] = await Promise.all([
    getDeviceToken(),
    getSessionToken(),
  ]);
  if (!device && !session) redirect("/login?next=%2Fm%2Ffinal-release");

  const queue = await getFinalReleaseQueue();
  const items = queue?.items ?? [];

  return (
    <div className="flex min-h-dvh flex-col bg-muted/30">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex items-center gap-2">
          <Link
            href="/m"
            aria-label="Back"
            className="-ml-2 rounded-md p-1.5 text-muted-foreground"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-semibold tracking-tight">
              Final Product Release
            </h1>
            <p className="text-[11px] text-muted-foreground">
              {items.length} lot{items.length === 1 ? "" : "s"} awaiting QA
              sign-off · BRCGS 5.6
            </p>
          </div>
        </div>
      </header>

      <main className="flex-1 space-y-2 px-3 py-3">
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border/60 px-4 py-12 text-center">
            <CheckCircle2 className="size-7 text-emerald-500/70" />
            <p className="text-sm font-semibold">Nothing awaiting release</p>
            <p className="text-xs text-muted-foreground">
              Finished lots arrive here once output QC passes. Attach the CoA
              + BMR + micro report + label proof, get a second signature, and
              release for dispatch.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {items.map((r) => {
              const lot = r.stock_lot;
              return (
                <li key={r.uuid}>
                  <Link
                    href={`/production/final-releases/${encodeURIComponent(lot?.uuid ?? "")}`}
                    className="flex w-full items-center gap-3 rounded-xl border border-border/60 bg-card px-3 py-3 active:bg-muted"
                  >
                    <ShieldCheck className="size-4 shrink-0 text-sky-600" />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-baseline gap-2 min-w-0">
                        <span className="font-mono text-xs font-semibold text-muted-foreground">
                          {lot?.code ?? "—"}
                        </span>
                        <span className="truncate text-sm font-medium">
                          {lot?.item?.name ?? "Finished lot"}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {r.manufacturing_order?.code ?? "—"}
                        {lot?.placement
                          ? ` · ${lot.placement.warehouse?.name ?? "?"} / ${lot.placement.cell_name ?? "?"}`
                          : null}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {r.files.length}/{r.required_file_kinds.length} files ·{" "}
                        {r.releaser_id ? "R signed" : "R pending"} ·{" "}
                        {r.approver_id ? "A signed" : "A pending"}
                      </p>
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
