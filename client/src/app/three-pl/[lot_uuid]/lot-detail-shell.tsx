"use client";

import { useState } from "react";
import {
  Boxes,
  Calendar,
  CheckCircle2,
  FileText,
  MapPin,
  Package,
  Paperclip,
  Timer,
  Truck,
  User,
} from "lucide-react";
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
import type { CompanyDefaults } from "@/lib/types";
import type {
  ThreePLLotDetailResponse,
  ThreePLReleaseFile,
} from "@/lib/three-pl/types";
import { DispatchDialog } from "../dispatch-dialog";

const FILE_KIND_LABEL: Record<string, string> = {
  coa: "Certificate of Analysis",
  bmr: "Batch Manufacturing Record",
  micro: "Micro / potency test report",
  label_proof: "Label proof",
  retain_sample: "Retention sample photo",
  label_retain: "Label / retention sample",
};

interface Props {
  detail: ThreePLLotDetailResponse;
  companyDefaults: CompanyDefaults | null;
}

/**
 * Full 3PL item page — bailee-custody lot detail. Three main
 * sections: summary stats (held vs dispatched, days, accrued),
 * Positive Release paperwork (CoA / BMR / micro / label proof /
 * retention sample), and dispatch history.
 */
export function LotDetailShell({ detail, companyDefaults }: Props) {
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const { lot, summary, dispatches, release } = detail;
  const placement = lot.placements?.[0];
  const cell = placement?.storage_cell;
  const location = cell?.storage_location;
  const misplaced = cell?.purpose && cell.purpose !== "three_pl_storage";
  const unit = lot.unit_of_measurement?.symbol ?? "";
  const rateLine =
    summary.rate && summary.currency
      ? `${summary.rate} ${summary.currency}/m³/day`
      : "no rate configured";
  const dispatchRow = {
    lot,
    stored_volume_m3: summary.held_volume_m3,
    days_held: summary.days_held,
    accrued_amount: summary.accrued_amount,
  };

  return (
    <div className="space-y-6">
      {/* -------- Summary grid -------- */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<Package className="size-4" />}
          label="Held now"
          value={
            summary.held_qty !== null
              ? `${summary.held_qty}${unit ? ` ${unit}` : ""}`
              : "—"
          }
          hint={`of ${summary.original_qty ?? "—"}${unit ? ` ${unit}` : ""} original`}
        />
        <StatCard
          icon={<Truck className="size-4" />}
          label="Dispatched"
          value={
            summary.dispatched_qty !== null
              ? `${summary.dispatched_qty}${unit ? ` ${unit}` : ""}`
              : "—"
          }
          hint={`${dispatches.length} dispatch${dispatches.length === 1 ? "" : "es"} recorded`}
        />
        <StatCard
          icon={<Boxes className="size-4" />}
          label="Volume held"
          value={`${summary.held_volume_m3} m³`}
          hint={`${summary.days_held} day${summary.days_held === 1 ? "" : "s"} in custody`}
        />
        <StatCard
          icon={<Timer className="size-4" />}
          label="Accrued"
          value={
            summary.accrued_amount !== null && summary.currency
              ? `${summary.accrued_amount} ${summary.currency}`
              : "—"
          }
          hint={`Rate: ${rateLine}`}
        />
      </div>

      {/* -------- Identity + placement -------- */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Lot identity</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <DetailRow
            label="Code"
            value={
              <span className="font-mono">{lot.code ?? "—"}</span>
            }
          />
          <DetailRow
            label="Batch"
            value={lot.supplier_batch_no || "—"}
            mono
          />
          <DetailRow
            label="Item"
            value={lot.item?.name ?? "—"}
          />
          <DetailRow
            label="Bailee customer"
            value={lot.bailee_customer?.name ?? "—"}
          />
          <DetailRow
            label="Manufactured"
            value={formatCompanyDate(lot.manufactured_at, companyDefaults)}
          />
          <DetailRow
            label="Expires"
            value={formatCompanyDate(lot.expiry_at, companyDefaults)}
          />
          <DetailRow
            label="Routed to bailee"
            value={formatCompanyDate(lot.bailee_routed_at, companyDefaults)}
          />
          <DetailRow
            label="Package"
            value={
              lot.package_length_mm &&
              lot.package_width_mm &&
              lot.package_height_mm
                ? `${lot.package_length_mm}×${lot.package_width_mm}×${lot.package_height_mm} mm`
                : "—"
            }
          />
          <DetailRow
            label="Placement"
            value={
              <span
                className={cn(
                  "inline-flex items-center gap-1",
                  misplaced && "text-amber-700 dark:text-amber-300",
                )}
              >
                <MapPin className="size-3.5" />
                {locationLabel(location) ?? "—"}
                {cellLabel(cell) ? ` · ${cellLabel(cell)}` : ""}
                {misplaced && " (needs move)"}
              </span>
            }
          />
          <DetailRow
            label="Warehouse"
            value={cell?.warehouse?.name ?? "—"}
          />
        </CardContent>
      </Card>

      {/* -------- Paperwork (Positive Release) -------- */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <FileText className="size-4" />
            Positive Release paperwork
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!release ? (
            <p className="text-xs text-muted-foreground">
              This lot wasn&apos;t routed through the Positive Release
              ceremony (opening balance / manual receive). No BRCGS § 5.6
              paperwork attached.
            </p>
          ) : (
            <>
              <div className="grid gap-2 sm:grid-cols-3 text-xs">
                <SigLine
                  label="Releaser"
                  who={release.releaser?.name}
                  when={release.finalized_at}
                />
                <SigLine
                  label="Approver"
                  who={release.approver?.name}
                  when={release.finalized_at}
                />
                <SigLine
                  label="Finalised"
                  who={release.finalized_by?.name ?? release.status}
                  when={release.finalized_at}
                />
              </div>
              {release.files.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No files attached to the release row.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {release.files.map((f) => (
                    <FileRow
                      key={f.uuid}
                      file={f}
                      releaseUuid={release.uuid}
                      companyDefaults={companyDefaults}
                    />
                  ))}
                </ul>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* -------- Dispatch history -------- */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Truck className="size-4" />
              Dispatch history
            </CardTitle>
            <Button
              type="button"
              size="sm"
              disabled={!!misplaced}
              onClick={() => setDispatchOpen(true)}
              title={
                misplaced
                  ? "Move the lot into a three_pl_storage cell before dispatching."
                  : "Record a new outbound dispatch."
              }
            >
              <Truck className="mr-1 size-3.5" />
              New dispatch
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {dispatches.length === 0 ? (
            <p className="px-4 py-4 text-xs text-muted-foreground">
              Nothing dispatched yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/60 bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <Th>When</Th>
                    <Th className="text-right">Qty</Th>
                    <Th>Reference</Th>
                    <Th>By</Th>
                    <Th>Evidence</Th>
                  </tr>
                </thead>
                <tbody>
                  {dispatches.map((d) => (
                    <tr
                      key={d.uuid}
                      className="border-b border-border/40 last:border-b-0"
                    >
                      <Td>
                        {formatCompanyDate(d.dispatched_at, companyDefaults)}
                      </Td>
                      <Td className="text-right font-mono">
                        {d.qty}
                        {unit ? ` ${unit}` : ""}
                      </Td>
                      <Td>{d.reference || "—"}</Td>
                      <Td>{d.dispatched_by?.name ?? "—"}</Td>
                      <Td>
                        {d.photo_url ? (
                          <a
                            href={d.photo_url}
                            target="_blank"
                            rel="noopener"
                            className="inline-flex items-center gap-1 text-brand hover:underline"
                          >
                            <Paperclip className="size-3" />
                            Photo
                          </a>
                        ) : (
                          <span className="text-muted-foreground/60">—</span>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <DispatchDialog
        open={dispatchOpen}
        onOpenChange={setDispatchOpen}
        row={dispatchRow}
      />
    </div>
  );
}

// ---------------- Row components ----------------

function StatCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[minmax(120px,1fr)_2fr] items-baseline gap-2">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "text-sm text-foreground",
          mono && "font-mono text-xs",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function SigLine({
  label,
  who,
  when,
}: {
  label: string;
  who: string | null | undefined;
  when: string | null;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-background p-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        <User className="size-3" />
        {label}
      </div>
      <div className="mt-0.5 text-xs font-semibold">{who ?? "—"}</div>
      {when && (
        <div className="text-[10px] text-muted-foreground">
          <Calendar className="mr-0.5 inline size-2.5" />
          {new Date(when).toLocaleString()}
        </div>
      )}
    </div>
  );
}

function FileRow({
  file,
  releaseUuid,
  companyDefaults,
}: {
  file: ThreePLReleaseFile;
  releaseUuid: string;
  companyDefaults: CompanyDefaults | null;
}) {
  const label = FILE_KIND_LABEL[file.kind] ?? file.kind;
  return (
    <li className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background px-2 py-1.5 text-xs">
      <div className="flex min-w-0 items-center gap-2">
        <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" />
        <div className="min-w-0">
          <div className="truncate font-medium">{label}</div>
          <div className="truncate text-[10px] text-muted-foreground">
            {file.filename} · {(file.byte_size / 1024).toFixed(1)} KB ·
            uploaded {formatCompanyDate(file.uploaded_at, companyDefaults)}
          </div>
        </div>
      </div>
      <a
        href={`/api/production/final-releases/${encodeURIComponent(releaseUuid)}/files/${encodeURIComponent(file.uuid)}`}
        target="_blank"
        rel="noopener"
        className="shrink-0 text-brand hover:underline"
      >
        Open
      </a>
    </li>
  );
}

// ---------------- Small helpers ----------------

function locationLabel(
  loc: { name?: string | null; code?: string | null } | null | undefined,
): string | null {
  if (!loc) return null;
  const name = loc.name?.trim();
  if (name) return name;
  const code = loc.code?.trim();
  if (code) return code;
  return null;
}

function cellLabel(
  cell:
    | { name?: string | null; code?: string | null; ordinal?: number | null }
    | null
    | undefined,
): string | null {
  if (!cell) return null;
  const name = cell.name?.trim();
  if (name) return name;
  const code = cell.code?.trim();
  if (code) return code;
  if (typeof cell.ordinal === "number") return `Level ${cell.ordinal + 1}`;
  return null;
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
  return <td className={cn("px-3 py-2 align-top", className)}>{children}</td>;
}
