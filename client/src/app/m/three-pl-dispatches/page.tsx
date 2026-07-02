import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, MapPin, Package, Truck } from "lucide-react";
import { getDeviceToken } from "@/lib/devices/server";
import { listPendingDispatches } from "@/lib/three-pl/server";

export const metadata = { title: "3PL dispatches · PSP Mobile" };
export const dynamic = "force-dynamic";

export default async function MobileThreePlDispatchesPage() {
  const token = await getDeviceToken();
  if (!token) redirect("/pair");

  const items = await listPendingDispatches();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center gap-2 border-b border-border/60 px-3 py-3">
        <Link
          href="/m"
          className="rounded-md p-1.5 text-muted-foreground active:bg-muted"
          aria-label="Back to home"
        >
          <ChevronLeft className="size-5" />
        </Link>
        <div className="min-w-0">
          <p className="truncate text-xs uppercase tracking-wider text-muted-foreground">
            3PL dispatches
          </p>
          <p className="truncate text-sm font-semibold">
            {items.length} pending
          </p>
        </div>
      </header>

      <main className="flex-1 space-y-3 px-3 py-4">
        {items.length === 0 ? (
          <p className="text-center text-xs text-muted-foreground">
            Nothing to pick right now. The desktop team queues 3PL dispatches
            here when a customer wants their goods sent out.
          </p>
        ) : (
          items.map((row) => (
            <Link
              key={row.uuid}
              href={`/m/three-pl-dispatches/${encodeURIComponent(row.uuid)}`}
              className="block rounded-lg border border-border/60 bg-card p-3 active:bg-muted"
            >
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-md bg-violet-500/10 text-violet-700 dark:text-violet-300">
                  <Truck className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {row.qty}
                    {row.lot?.unit_symbol
                      ? ` ${row.lot.unit_symbol}`
                      : ""}{" "}
                    of {row.lot?.item?.name ?? "—"}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    Held for {row.lot?.bailee_customer?.name ?? "—"}
                    {row.reference ? ` · ref ${row.reference}` : ""}
                  </p>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Package className="size-3" />
                  <span className="font-mono">{row.lot?.code ?? "—"}</span>
                </div>
                <div className="flex items-center gap-1 text-muted-foreground">
                  <MapPin className="size-3" />
                  {sourceLabel(row.source_location, row.source_cell)}
                </div>
              </div>
              {row.notes && (
                <p className="mt-2 rounded-md bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground">
                  {row.notes}
                </p>
              )}
            </Link>
          ))
        )}
      </main>
    </div>
  );
}

function sourceLabel(
  loc: { name: string | null; code: string | null } | null,
  cell: {
    name: string | null;
    code: string | null;
    ordinal: number;
  } | null,
): string {
  const locPart = loc?.name?.trim() || loc?.code?.trim() || "—";
  const cellPart =
    cell?.name?.trim() ||
    cell?.code?.trim() ||
    (typeof cell?.ordinal === "number" ? `Level ${cell.ordinal + 1}` : null);
  return cellPart ? `${locPart} · ${cellPart}` : locPart;
}
