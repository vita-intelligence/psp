import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import {
  Building2,
  Camera,
  ChevronLeft,
  Layers,
  MapPin,
  Package,
} from "lucide-react";
import { getDeviceToken } from "@/lib/devices/server";
import { getCellForScan } from "@/lib/stock/mobile";
import { Button } from "@/components/ui/button";
import { purposeMeta } from "@/lib/storage-cells/purpose";

export const metadata = { title: "Cell · PSP Mobile" };

interface Props {
  params: Promise<{ uuid: string }>;
}

/**
 * Mobile landing page hit when the operator scans a storage cell's
 * QR sticker from the standalone /m/scan flow. Previously a
 * deep-link 404 — `routeFromUrl` in the scanner already pointed
 * here, but the route didn't exist.
 *
 * Renders the cell breadcrumb so the worker can verify they're at
 * the right shelf. From here they tap "Scan a lot to move here" to
 * pick up the put-away flow with this cell pre-set as the
 * destination (slice-next; for now the action button reopens the
 * scanner so the worker can scan the lot QR they're holding).
 */
export default async function MobileCellScanPage({ params }: Props) {
  const token = await getDeviceToken();
  if (!token) redirect("/pair");

  const { uuid } = await params;
  const cell = await getCellForScan(uuid);
  if (!cell) notFound();

  const cellPrimary = cell.code?.trim() || cell.name?.trim() || "—";
  const cellSecondary = cell.code && cell.name ? cell.name : null;
  const purpose = purposeMeta(
    (cell as { purpose?: string | null }).purpose ?? "regular",
  );

  const locCode = cell.storage_location?.code?.trim() || null;
  const locName = cell.storage_location?.name?.trim() || null;
  const locPrimary = locCode ?? locName ?? "—";
  const locSecondary = locCode && locName ? locName : null;

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
          <p className="truncate font-mono text-xs text-muted-foreground">
            {cellPrimary}
          </p>
          <p className="truncate text-sm font-semibold">
            {cellSecondary ?? cell.warehouse?.name ?? "Cell scanned"}
          </p>
        </div>
      </header>

      <main className="flex-1 space-y-4 px-4 py-4">
        {/* Headline confirms the worker is at the right shelf — same
            code that's printed on the sticker, large, mono. */}
        <section className="rounded-lg border border-border/60 bg-card p-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            You scanned
          </p>
          <p className="mt-1 font-mono text-3xl font-semibold">{cellPrimary}</p>
          {cellSecondary && (
            <p className="text-sm text-muted-foreground">{cellSecondary}</p>
          )}
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span
              className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${purpose.chipClassName}`}
              title={purpose.description}
            >
              {purpose.label}
            </span>
            {(cell.tags ?? []).map((t) => (
              <span
                key={t}
                className="inline-flex items-center rounded-full bg-foreground/10 px-1.5 py-0.5 font-mono text-[10px]"
              >
                {t}
              </span>
            ))}
          </div>
        </section>

        {/* Breadcrumb so the worker knows where on the plan this shelf
            actually sits. */}
        <section className="space-y-2 rounded-lg border border-border/60 bg-card p-4">
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground">
            Where this is
          </h2>
          <DetailRow
            icon={Building2}
            label="Warehouse"
            value={cell.warehouse?.name ?? "—"}
          />
          <DetailRow
            icon={Layers}
            label="Floor"
            value={cell.floor?.name ?? "—"}
          />
          <DetailRow
            icon={MapPin}
            label="Location"
            value={locPrimary}
            suffix={locSecondary}
            mono={!!locCode}
          />
          <DetailRow
            icon={Package}
            label="Cell"
            value={cellPrimary}
            suffix={cellSecondary}
            mono={!!cell.code}
          />
        </section>
      </main>

      <footer className="space-y-2 border-t border-border/60 px-4 py-3">
        {/* `?to=<cell_uuid>` carries this cell through to the lot
            scanner. The scanner reads `to`, and on a successful lot
            scan routes the operator into the move flow with this
            cell pre-set as the destination — skipping the
            recommendation step entirely. */}
        <Button asChild size="lg" className="h-12 w-full">
          <Link href={`/m/scan?to=${encodeURIComponent(cell.uuid)}`}>
            <Camera className="mr-2 size-4" />
            Scan a lot to move here
          </Link>
        </Button>
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="w-full text-muted-foreground"
        >
          <Link href="/m">Back to menu</Link>
        </Button>
      </footer>
    </div>
  );
}

function DetailRow({
  icon: Icon,
  label,
  value,
  suffix,
  mono,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  suffix?: string | null;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p
          className={
            mono ? "truncate font-mono text-[13px]" : "truncate text-[13px]"
          }
        >
          {value}
          {suffix && (
            <span className="ml-1 text-muted-foreground">· {suffix}</span>
          )}
        </p>
      </div>
    </div>
  );
}
