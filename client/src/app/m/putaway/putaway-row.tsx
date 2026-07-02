"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Building2,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Layers,
  MapPin,
  Package,
  ShieldCheck,
} from "lucide-react";
import { FloorPlanMini } from "@/components/warehouses/floor-plan-mini";
import type { StockLot } from "@/lib/types";

/**
 * One row on the mobile /m/putaway list. Shows the breadcrumb
 * (warehouse → floor → rack → cell) so the operator knows where to
 * WALK to scan the lot; tap "Show map" to expand a floor-plan
 * thumbnail with the current cell pinned. The whole row is a
 * `<Link>` to the scan page — the map expand button intercepts the
 * click so the operator can peek at the location without leaving
 * the queue.
 */
export function PutawayRow({ lot }: { lot: StockLot }) {
  const [showMap, setShowMap] = useState(false);
  const active = firstActivePlacement(lot);
  const cell = active?.storage_cell ?? null;
  const loc = cell?.storage_location ?? null;
  const floor = cell?.floor ?? null;
  const warehouse = cell?.warehouse ?? null;
  const canRenderPlan =
    !!floor?.uuid && !!loc?.uuid && !cell?.system_kind && !floor.system_kind;

  return (
    <li>
      <div className="rounded-lg border border-border/60 bg-card">
        <Link
          href={`/m/lots/${lot.uuid}`}
          className="flex items-center gap-3 px-3 py-3 active:bg-muted rounded-t-lg"
        >
          <div className="flex-1 space-y-1 min-w-0">
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

        {/* Location breadcrumb — always visible so the operator can
            read where the lot is at a glance without expanding the
            map. */}
        <div className="grid grid-cols-2 gap-x-2 gap-y-1 border-t border-border/40 px-3 py-2 text-[11px]">
          <BreadcrumbRow
            icon={Building2}
            label="Warehouse"
            value={warehouse?.name ?? "—"}
          />
          <BreadcrumbRow
            icon={Layers}
            label="Floor"
            value={floor?.name ?? "—"}
          />
          <BreadcrumbRow
            icon={MapPin}
            label="Rack"
            value={loc?.code ?? loc?.name ?? "—"}
            suffix={loc?.code && loc?.name ? loc.name : null}
          />
          <BreadcrumbRow
            icon={Package}
            label="Cell"
            value={cell?.name ?? (cell ? `Cell #${cell.id}` : "—")}
            suffix={
              cell && cell.ordinal !== null && cell.ordinal !== undefined
                ? `Level ${cell.ordinal + 1}`
                : null
            }
          />
        </div>

        {/* Map expand — only meaningful when we have a real floor +
            location to point at. System cells (Unregistered) skip
            the map with a hint instead. */}
        {canRenderPlan ? (
          <div className="border-t border-border/40">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 rounded-b-lg px-3 py-2 text-[11px] font-medium text-muted-foreground active:bg-muted"
              onClick={() => setShowMap((v) => !v)}
              aria-expanded={showMap}
            >
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="size-3.5" />
                {showMap ? "Hide map" : "Show me on the floor plan"}
              </span>
              {showMap ? (
                <ChevronUp className="size-3.5" />
              ) : (
                <ChevronDown className="size-3.5" />
              )}
            </button>
            {showMap && (
              <div className="border-t border-border/40 px-3 py-3">
                <FloorPlanMini
                  floorUuid={floor!.uuid}
                  targetLocationUuid={loc!.uuid}
                  apiPath={(uuid) =>
                    `/api/stock/floors/${encodeURIComponent(uuid)}/plan`
                  }
                  footerLabel="Walk to the pinned rack — that's where the lot is."
                />
              </div>
            )}
          </div>
        ) : cell?.system_kind === "unregistered" ? (
          <div className="rounded-b-lg border-t border-border/40 bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
            System cell (no floor plan). Find the lot at the
            <span className="mx-1 font-medium text-foreground">
              {cell.name ?? "receiving / staging"}
            </span>
            zone.
          </div>
        ) : null}
      </div>
    </li>
  );
}

function BreadcrumbRow({
  icon: Icon,
  label,
  value,
  suffix,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  suffix?: string | null;
}) {
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <Icon className="size-3 shrink-0 text-muted-foreground" />
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="ml-auto min-w-0 truncate font-medium text-foreground">
        {value}
      </span>
      {suffix && (
        <span className="text-[10px] text-muted-foreground">{suffix}</span>
      )}
    </div>
  );
}

function firstActivePlacement(lot: StockLot) {
  return (
    lot.placements?.find((p) => {
      const q = parseFloat(p.qty ?? "0");
      return !Number.isNaN(q) && q > 0;
    }) ?? null
  );
}
