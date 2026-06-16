import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  FileWarning,
  MapPin,
  MoveRight,
  Package,
  Snowflake,
  Tag,
} from "lucide-react";
import { getDeviceToken } from "@/lib/devices/server";
import { getLotForScan } from "@/lib/stock/mobile";
import { computeLotHandlingTags } from "@/lib/stock/handling-tags";
import type { StockLot } from "@/lib/types";

export const metadata = { title: "Lot · PSP Mobile" };

interface Props {
  params: Promise<{ uuid: string }>;
}

/**
 * Mobile lot detail page. Stands between the home page's pending-
 * put-away card and the move flow so the worker can verify the lot
 * by its visible identifiers (item, supplier batch, dates) BEFORE
 * walking it anywhere. The "Move to shelf" action is only active
 * when the lot is actually in a state that wants put-away — i.e.
 * sitting in the auto-managed `Unregistered` cell.
 */
export default async function MobileLotPage({ params }: Props) {
  const token = await getDeviceToken();
  if (!token) redirect("/pair");

  const { uuid } = await params;
  const data = await getLotForScan(uuid);
  if (!data) notFound();

  const lot = data.lot;
  const placement = lot.placements?.find((p) => Number(p.qty) > 0);
  const cell = placement?.storage_cell;
  const location = cell?.storage_location;
  const symbol = lot.unit_of_measurement?.symbol ?? "";

  // Put-away applies when the lot is still in the auto-managed
  // Unregistered cell. Once it lives in a real shelf the action
  // becomes "move" (same flow, different semantics) — same UI for
  // both for now; the next slice can split if needed.
  const isPendingPutaway = cell?.system_kind === "unregistered";

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
          <p className="truncate font-mono text-xs text-muted-foreground">
            {lot.code ?? `Lot #${lot.id}`}
          </p>
          <p className="truncate text-sm font-semibold">
            {lot.item?.name ?? "—"}
          </p>
        </div>
      </header>

      <main className="flex-1 space-y-4 px-4 py-4">
        {/* Headline: current qty + where it lives right now. */}
        <section className="rounded-lg border border-border/60 bg-card p-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            On hand
          </p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-3xl font-semibold">
              {lot.qty_on_hand ?? "—"}
            </span>
            <span className="text-sm text-muted-foreground">{symbol}</span>
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="size-3.5" />
            <span>
              {location?.name ?? "—"}
              {cell ? ` · ${cell.name ?? "—"}` : ""}
            </span>
          </div>
          {isPendingPutaway && (
            <span className="mt-2 inline-flex rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
              Pending put-away
            </span>
          )}
        </section>

        {/* Identity card — what a worker checks against the physical
            drum before they pick it up. Batch + item are the headline
            fields the operator reads off the supplier's label. */}
        <section className="space-y-2 rounded-lg border border-border/60 bg-card p-4">
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground">
            Identification
          </h2>
          <DetailRow icon={Package} label="Item" value={lot.item?.name ?? "—"} />
          <DetailRow
            icon={Tag}
            label="Supplier batch"
            value={lot.supplier_batch_no || "—"}
            mono
          />
          <DetailRow
            icon={Tag}
            label="Revision"
            value={lot.revision || "—"}
            mono
          />
          <DetailRow
            icon={Tag}
            label="Country of origin"
            value={lot.country_of_origin || "—"}
            mono
          />
          <DetailRow
            icon={Calendar}
            label="Manufactured"
            value={lot.manufactured_at || "—"}
          />
          <DetailRow
            icon={Calendar}
            label="Expires"
            value={lot.expiry_at || "—"}
          />
          <HandlingChips lot={lot} />
        </section>

        {/* Action — the same move flow works whether the lot is on
            the Unregistered cell (first put-away) or on a real shelf
            (relocate). Wording changes based on current state. The
            BE recommender excludes the lot's current cell from
            suggestions so "move to where I already am" never appears. */}
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
              <p className="text-sm font-semibold">
                {isPendingPutaway ? "Move to a shelf" : "Move to another shelf"}
              </p>
              <p className="text-xs text-muted-foreground">
                {isPendingPutaway
                  ? "Scan the lot to confirm, walk to the suggested cell, scan to land + photo."
                  : `Currently on ${location?.name ?? "a shelf"}. Pick a new cell, scan, photo, done.`}
              </p>
            </div>
          </Link>

          {/* Consume / Dispose actions land in follow-up slices. */}
        </section>
      </main>
    </div>
  );
}

function HandlingChips({ lot }: { lot: StockLot }) {
  const tags = computeLotHandlingTags(lot.item);
  if (tags.length === 0) return null;
  return (
    <div className="space-y-1.5 pt-1">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        Handling
      </p>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag) => {
          const Icon = HANDLING_ICON[tag.icon];
          return (
            <span
              key={tag.key}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${tag.className}`}
              title={tag.title}
            >
              {Icon ? <Icon className="size-2.5" /> : null}
              {tag.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

const HANDLING_ICON = {
  alert: AlertTriangle,
  check: CheckCircle2,
  warning: FileWarning,
  cold: Snowflake,
} as const;

function DetailRow({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
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
            mono
              ? "truncate font-mono text-[13px]"
              : "truncate text-[13px]"
          }
        >
          {value}
        </p>
      </div>
    </div>
  );
}
