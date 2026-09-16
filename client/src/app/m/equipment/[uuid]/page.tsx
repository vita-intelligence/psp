import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  AlertTriangle,
  Building2,
  Calendar,
  ChevronLeft,
  Cog,
  Layers,
  MapPin,
  User,
} from "lucide-react";
import { getDeviceToken } from "@/lib/devices/server";
import { getEquipmentForScan } from "@/lib/equipment/mobile";
import { getCompanyDefaults } from "@/lib/company/server";
import { formatCompanyDate } from "@/lib/format/company";
import { SendToLaptopButton } from "./send-to-laptop-button";
import { MoveButton } from "./move-button";

export const metadata = { title: "Equipment · PSP Mobile" };

interface Props {
  params: Promise<{ uuid: string }>;
}

/**
 * Mobile equipment detail page — the target of a QR-label scan.
 * Shows the identity + location + next-due chips + quick actions:
 *
 *   * Send to laptop — bridges to the paired desktop session
 *   * Move — same MoveEquipmentDialog as the desktop, in tap-size
 *
 * Auth: device-token cookie set at pairing. No session required —
 * a phone paired to any operator can scan.
 */
export default async function MobileEquipmentPage({ params }: Props) {
  const token = await getDeviceToken();
  if (!token) redirect("/pair");

  const { uuid } = await params;
  const [equipment, prefs] = await Promise.all([
    getEquipmentForScan(uuid),
    getCompanyDefaults(),
  ]);
  if (!equipment) notFound();

  const itemName = equipment.item?.name ?? equipment.model ?? "Equipment";
  const locationLine = equipment.assigned_to
    ? `Assigned to ${equipment.assigned_to.name}`
    : equipment.current_cell
      ? `${equipment.current_cell.name}${equipment.current_cell.warehouse?.name ? ` · ${equipment.current_cell.warehouse.name}` : ""}`
      : equipment.location_description
        ? equipment.location_description
        : null;

  const nextCal = equipment.next_calibration_at;
  const nextMaint = equipment.next_maintenance_at;
  const now = Date.now();
  const overdueCal =
    nextCal && new Date(nextCal).getTime() < now;
  const overdueMaint =
    nextMaint && new Date(nextMaint).getTime() < now;

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-6">
      <Link
        href="/m"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground"
      >
        <ChevronLeft className="size-3.5" />
        Back
      </Link>

      {/* Identity card */}
      <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted">
            <Cog className="size-5 text-muted-foreground" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Equipment
            </p>
            <h1 className="truncate text-lg font-semibold">{itemName}</h1>
            <p className="mt-0.5 font-mono text-xs text-muted-foreground">
              {equipment.serial_number}
            </p>
          </div>
        </div>

        <dl className="mt-4 space-y-2 text-sm">
          {equipment.category && (
            <Row
              icon={<Layers className="size-3.5" />}
              label="Category"
              value={equipment.category.name}
            />
          )}
          {(equipment.manufacturer || equipment.model) && (
            <Row
              icon={<Building2 className="size-3.5" />}
              label="Make"
              value={[equipment.manufacturer, equipment.model]
                .filter(Boolean)
                .join(" ")}
            />
          )}
          {locationLine && (
            <Row
              icon={<MapPin className="size-3.5" />}
              label="Location"
              value={locationLine}
            />
          )}
          {equipment.workstation && (
            <Row
              icon={<Cog className="size-3.5" />}
              label="Workstation"
              value={equipment.workstation.name}
            />
          )}
          {equipment.assigned_to && (
            <Row
              icon={<User className="size-3.5" />}
              label="Assigned to"
              value={equipment.assigned_to.name}
            />
          )}
        </dl>
      </div>

      {/* Due chips */}
      {(nextCal || nextMaint) && (
        <div className="grid grid-cols-2 gap-2">
          {nextCal && (
            <DueChip
              label="Next calibration"
              date={formatCompanyDate(nextCal, prefs ?? {})}
              overdue={!!overdueCal}
            />
          )}
          {nextMaint && (
            <DueChip
              label="Next maintenance"
              date={formatCompanyDate(nextMaint, prefs ?? {})}
              overdue={!!overdueMaint}
            />
          )}
        </div>
      )}

      {/* Actions */}
      <div className="space-y-2">
        <SendToLaptopButton uuid={equipment.uuid} title={itemName} />
        <MoveButton uuid={equipment.uuid} />
      </div>

      <p className="pt-2 text-center text-[10px] text-muted-foreground">
        Serial {equipment.serial_number} · Status {equipment.status}
      </p>
    </div>
  );
}

function Row({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <div className="min-w-0 flex-1">
        <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </dt>
        <dd className="truncate font-medium">{value}</dd>
      </div>
    </div>
  );
}

function DueChip({
  label,
  date,
  overdue,
}: {
  label: string;
  date: string;
  overdue: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-3 text-xs ${
        overdue
          ? "border-destructive/40 bg-destructive/5 text-destructive"
          : "border-border/60 bg-card"
      }`}
    >
      <div className="flex items-center gap-1.5">
        <Calendar className="size-3" />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      </div>
      <p className="mt-0.5 text-sm font-semibold">{date}</p>
      {overdue && (
        <p className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-medium">
          <AlertTriangle className="size-3" />
          Overdue
        </p>
      )}
    </div>
  );
}
