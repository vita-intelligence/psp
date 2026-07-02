import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, PackageOpen } from "lucide-react";
import { getDeviceToken } from "@/lib/devices/server";
import { getSessionToken } from "@/lib/auth/server";
import { listPendingPutaway } from "@/lib/stock/mobile";
import { PutawayRow } from "./putaway-row";

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
          <ul className="space-y-3">
            {pendingLots.map((lot) => (
              <PutawayRow key={lot.uuid} lot={lot} />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
