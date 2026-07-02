"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Boxes, MapPin, Timer, ExternalLink, Truck } from "lucide-react";
import type { ThreePLInventoryRow } from "@/lib/three-pl/types";
import type { CompanyDefaults } from "@/lib/types";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge-mini";
import { Button } from "@/components/ui/button";
import { formatCompanyDate } from "@/lib/format/company";
import { cn } from "@/lib/utils";
import { DispatchDialog } from "./dispatch-dialog";

interface Props {
  items: ThreePLInventoryRow[];
  companyDefaults: CompanyDefaults | null;
  currency: string | null;
}

interface CustomerGroup {
  customerUuid: string;
  customerName: string;
  rows: ThreePLInventoryRow[];
  totalVolume: number;
  totalCharge: number;
  hasChargeData: boolean;
}

/**
 * Bailee-custody inventory grouped by customer. Each customer's card
 * lists every lot we're currently holding for them, with volume /
 * days held / current placement. Storage billing (Phase 2) will
 * multiply the customer-level total volume by the company-configured
 * m³-per-day rate to surface a running revenue chip here.
 */
export function ThreePLInventoryTable({
  items,
  companyDefaults,
  currency,
}: Props) {
  const [dispatchRow, setDispatchRow] = useState<ThreePLInventoryRow | null>(
    null,
  );
  const groups = useMemo<CustomerGroup[]>(() => {
    const byCustomer = new Map<string, CustomerGroup>();
    for (const row of items) {
      const c = row.lot.bailee_customer;
      // Belt-and-braces: bailee lots always have a customer. Skip
      // legacy rows that don't so the tab doesn't crash on nulls.
      if (!c) continue;
      const key = c.uuid;
      const bucket = byCustomer.get(key) ?? {
        customerUuid: c.uuid,
        customerName: c.name,
        rows: [],
        totalVolume: 0,
        totalCharge: 0,
        hasChargeData: false,
      };
      bucket.rows.push(row);
      bucket.totalVolume += Number(row.stored_volume_m3) || 0;
      if (row.accrued_amount !== null) {
        bucket.totalCharge += Number(row.accrued_amount) || 0;
        bucket.hasChargeData = true;
      }
      byCustomer.set(key, bucket);
    }
    return Array.from(byCustomer.values()).sort((a, b) =>
      a.customerName.localeCompare(b.customerName),
    );
  }, [items]);

  if (groups.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted/60">
            <Boxes className="size-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-semibold">Nothing in bailee custody</p>
          <p className="max-w-md text-xs text-muted-foreground">
            When Positive Release fires and the operator routes a lot to 3PL
            storage on the customer-order wizard, the lot shows up here. Own
            stock stays on the regular Stock tab.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <CustomerGroupCard
          key={group.customerUuid}
          group={group}
          companyDefaults={companyDefaults}
          currency={currency}
          onDispatch={setDispatchRow}
        />
      ))}
      <DispatchDialog
        open={dispatchRow !== null}
        onOpenChange={(open) => {
          if (!open) setDispatchRow(null);
        }}
        row={dispatchRow}
      />
    </div>
  );
}

function CustomerGroupCard({
  group,
  companyDefaults,
  currency,
  onDispatch,
}: {
  group: CustomerGroup;
  companyDefaults: CompanyDefaults | null;
  currency: string | null;
  onDispatch: (row: ThreePLInventoryRow) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            {group.customerName}
            <Badge tone="muted">
              {group.rows.length} lot{group.rows.length === 1 ? "" : "s"}
            </Badge>
          </CardTitle>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-violet-500/40 bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-800 dark:text-violet-200">
              {group.totalVolume.toFixed(2)} m³ total
            </span>
            {group.hasChargeData && currency && (
              <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:text-emerald-200">
                {group.totalCharge.toFixed(2)} {currency} accrued
              </span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/60 bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                <Th>Lot</Th>
                <Th>Item</Th>
                <Th className="text-right">Volume (m³)</Th>
                <Th className="text-right">Days held</Th>
                <Th className="text-right">Accrued</Th>
                <Th>Since</Th>
                <Th>Cell</Th>
                <Th className="text-right"> </Th>
              </tr>
            </thead>
            <tbody>
              {group.rows.map((row) => (
                <BaileeRow
                  key={row.lot.uuid}
                  row={row}
                  companyDefaults={companyDefaults}
                  currency={currency}
                  onDispatch={onDispatch}
                />
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function BaileeRow({
  row,
  companyDefaults,
  currency,
  onDispatch,
}: {
  row: ThreePLInventoryRow;
  companyDefaults: CompanyDefaults | null;
  currency: string | null;
  onDispatch: (row: ThreePLInventoryRow) => void;
}) {
  const lot = row.lot;
  const placement = lot.placements?.[0];
  const cell = placement?.storage_cell;
  const location = cell?.storage_location;
  const misplaced = cell?.purpose && cell.purpose !== "three_pl_storage";

  return (
    <tr className="border-b border-border/40 last:border-b-0 hover:bg-muted/20">
      <Td>
        <span className="font-mono text-[11px]">{lot.code ?? "—"}</span>
        {lot.supplier_batch_no && (
          <div className="text-[10px] text-muted-foreground">
            {lot.supplier_batch_no}
          </div>
        )}
      </Td>
      <Td>
        <span className="text-foreground">{lot.item?.name ?? "—"}</span>
      </Td>
      <Td className="text-right font-mono">{row.stored_volume_m3}</Td>
      <Td className="text-right">
        <span className="inline-flex items-center gap-1">
          <Timer className="size-3 text-muted-foreground" />
          {row.days_held}
        </span>
      </Td>
      <Td className="text-right font-mono">
        {row.accrued_amount === null || !currency ? (
          <span className="text-muted-foreground/60">—</span>
        ) : (
          <span>
            {row.accrued_amount} {currency}
          </span>
        )}
      </Td>
      <Td>{formatCompanyDate(lot.bailee_routed_at, companyDefaults)}</Td>
      <Td>
        <span
          className={cn(
            "inline-flex items-center gap-1 text-[11px]",
            misplaced && "text-amber-700 dark:text-amber-300",
          )}
        >
          <MapPin className="size-3" />
          {location?.name ?? "—"}
          {cell?.name ? ` · ${cell.name}` : ""}
          {misplaced && " (needs move)"}
        </span>
      </Td>
      <Td className="text-right">
        <div className="flex items-center justify-end gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2 text-[11px]"
            disabled={!!misplaced}
            title={
              misplaced
                ? "Move the lot into a three_pl_storage cell before dispatching."
                : "Dispatch a partial or full qty from this lot."
            }
            onClick={() => onDispatch(row)}
          >
            <Truck className="size-3" />
            Dispatch
          </Button>
          <Link
            href={`/stock/lots/${encodeURIComponent(lot.uuid)}`}
            className="inline-flex items-center gap-1 text-[11px] text-brand hover:underline"
          >
            Open <ExternalLink className="size-3" />
          </Link>
        </div>
      </Td>
    </tr>
  );
}

function Th({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th className={cn("px-3 py-2 text-left font-semibold", className)}>
      {children}
    </th>
  );
}

function Td({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <td className={cn("px-3 py-2 align-top", className)}>{children}</td>
  );
}

