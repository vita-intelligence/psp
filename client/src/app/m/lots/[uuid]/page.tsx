import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, MapPin, MoveRight } from "lucide-react";
import { getDeviceToken } from "@/lib/devices/server";
import { getLotForScan } from "@/lib/stock/mobile";

export const metadata = { title: "Lot · PSP Mobile" };

interface Props {
  params: Promise<{ uuid: string }>;
}

export default async function MobileLotPage({ params }: Props) {
  const token = await getDeviceToken();
  if (!token) redirect("/pair");

  const { uuid } = await params;
  const data = await getLotForScan(uuid);
  if (!data) notFound();

  const lot = data.lot;
  const placement = lot.placements?.find(
    (p) => Number(p.qty) > 0,
  );
  const cell = placement?.storage_cell;

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
          <p className="truncate text-xs text-muted-foreground">
            {lot.code ?? `Lot #${lot.id}`}
          </p>
          <p className="truncate text-sm font-semibold">
            {lot.item?.name ?? "—"}
          </p>
        </div>
      </header>

      <main className="flex-1 space-y-4 px-4 py-4">
        <section className="rounded-lg border border-border/60 bg-card p-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Current
          </p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-semibold">
              {lot.qty_on_hand ?? "—"}
            </span>
            <span className="text-sm text-muted-foreground">
              {lot.unit_of_measurement?.symbol ?? ""}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="size-3.5" />
            <span>{cell?.name ?? "—"}</span>
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground">
            What do you want to do?
          </h2>
          <Link
            href={`/m/lots/${lot.uuid}/move`}
            className="flex items-center gap-3 rounded-lg border border-border/60 bg-card px-4 py-4 active:bg-muted"
          >
            <span className="grid size-9 place-items-center rounded-full bg-brand/15 text-brand">
              <MoveRight className="size-5" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">Move to a shelf</p>
              <p className="text-xs text-muted-foreground">
                Scan the destination cell and confirm qty + photo.
              </p>
            </div>
          </Link>

          {/* Consume / Dispose actions land in follow-up slices. */}
        </section>
      </main>
    </div>
  );
}
