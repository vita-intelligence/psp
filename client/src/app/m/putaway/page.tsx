import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  PackageOpen,
  ShieldCheck,
} from "lucide-react";
import { getDeviceToken } from "@/lib/devices/server";
import { getSessionToken } from "@/lib/auth/server";
import { listPendingPutaway } from "@/lib/stock/mobile";

export const metadata = { title: "Pending put-away · PSP Mobile" };

/**
 * Pending put-away list — used to live on the mobile home (`/m`), now
 * a dedicated sub-page so the home can render a permission-gated
 * menu instead of dumping the list as the first thing the worker sees.
 *
 * Page is a server component because the list is short (typically <20
 * rows) and we want fresh data on every navigation in/out of the
 * camera flow.
 */
export default async function MobilePutawayPage() {
  const [deviceToken, sessionToken] = await Promise.all([
    getDeviceToken(),
    getSessionToken(),
  ]);
  if (!deviceToken && !sessionToken) redirect("/pair");

  const pendingLots = await listPendingPutaway();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center gap-2 border-b border-border/60 px-3 py-3">
        <Link
          href="/m"
          className="rounded-md p-1.5 text-muted-foreground active:bg-muted"
          aria-label="Back to menu"
        >
          <ChevronLeft className="size-5" />
        </Link>
        <div className="min-w-0">
          <p className="text-sm font-semibold">Pending put-away</p>
          <p className="text-xs text-muted-foreground">
            Lots waiting on a shelf decision — Unregistered arrivals,
            QC-cleared inbound, and finished goods heading to
            finished-quarantine before Final Product Release.
          </p>
        </div>
      </header>

      <main className="flex-1 space-y-4 px-4 py-4">
        {pendingLots.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border/60 px-4 py-12 text-center">
            <PackageOpen className="size-6 text-muted-foreground/60" />
            <p className="text-sm font-medium">All clear</p>
            <p className="text-xs text-muted-foreground">
              Nothing waiting on a shelf decision right now.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {pendingLots.map((lot) => (
              <li key={lot.uuid}>
                <Link
                  href={`/m/lots/${lot.uuid}`}
                  className="flex items-center gap-3 rounded-lg border border-border/60 bg-card px-3 py-3 active:bg-muted"
                >
                  <div className="flex-1 space-y-0.5 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-xs font-semibold">
                        {lot.code ?? `#${lot.id}`}
                      </span>
                      {lot.needs_release_quarantine_move ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:text-sky-300">
                          <ShieldCheck className="size-2.5" />
                          → Finished quarantine
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                          Unregistered
                        </span>
                      )}
                    </div>
                    <p className="truncate text-sm font-medium">
                      {lot.item?.name ?? "—"}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {lot.qty_on_hand ?? "—"}{" "}
                      {lot.unit_of_measurement?.symbol ?? ""}
                    </p>
                    {lot.needs_release_quarantine_move && (
                      <p className="text-[10px] text-sky-700 dark:text-sky-400">
                        BRCGS 5.6 — scan into any finished-quarantine cell.
                      </p>
                    )}
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
