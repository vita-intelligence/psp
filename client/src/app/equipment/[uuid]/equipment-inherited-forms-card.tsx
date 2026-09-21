import Link from "next/link";
import { ClipboardList, Sparkles, Wrench } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge-mini";
import type { CategoryFormAssignment } from "@/lib/equipment/server";
import type { EquipmentCategorySummary } from "@/lib/equipment/types";

interface Props {
  category: EquipmentCategorySummary | null;
  assignments: CategoryFormAssignment[];
}

/** Read-only card on the equipment detail page listing which forms
 *  fire on the kiosk when this specific machine is scoped to a
 *  cleaning or maintenance session. All forms are attached at the
 *  CATEGORY level (see `/settings/equipment-categories/[uuid]`) —
 *  editing lives there so one CIP checklist covers every V-blender
 *  in the plant. */
export function EquipmentInheritedFormsCard({ category, assignments }: Props) {
  const cleaning = assignments
    .filter((a) => a.slot === "equipment_cleaning" && a.form_template)
    .sort((a, b) => a.sort_order - b.sort_order);
  const maintenance = assignments
    .filter((a) => a.slot === "equipment_maintenance" && a.form_template)
    .sort((a, b) => a.sort_order - b.sort_order);

  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <ClipboardList
            className="size-4 text-muted-foreground"
            aria-hidden
          />
          Kiosk forms inherited from category
        </CardTitle>
        <CardDescription className="text-[12px]">
          {category ? (
            <>
              Every checklist attached to the{" "}
              <Link
                href={`/settings/equipment-categories/${encodeURIComponent(
                  category.uuid,
                )}`}
                className="font-medium underline-offset-2 hover:underline"
              >
                {category.name}
              </Link>{" "}
              category fires on this machine when an operator picks it
              on a cleaning / maintenance session. Edit assignments on
              the category page — one form covers every machine of the
              same kind.
            </>
          ) : (
            <>
              This equipment has no category assigned yet — assign one
              on the edit form so it can inherit shared cleaning +
              maintenance checklists.
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <SlotList
          title="Cleaning (equipment)"
          icon={<Sparkles className="size-3.5" aria-hidden />}
          rows={cleaning}
        />
        <SlotList
          title="Maintenance (equipment)"
          icon={<Wrench className="size-3.5" aria-hidden />}
          rows={maintenance}
        />
      </CardContent>
    </Card>
  );
}

function SlotList({
  title,
  icon,
  rows,
}: {
  title: string;
  icon: React.ReactNode;
  rows: CategoryFormAssignment[];
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {icon}
        {title}
      </div>
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border/60 px-3 py-3 text-xs text-muted-foreground">
          No forms attached to this slot on the category. When an
          operator scopes a session here, the kiosk will report
          &ldquo;No forms assigned&rdquo; and refuse to open the
          session.
        </p>
      ) : (
        <ul className="divide-y divide-border/40 rounded-md border border-border/60 bg-background/60">
          {rows.map((row, idx) => {
            const t = row.form_template!;
            return (
              <li
                key={row.uuid}
                className="flex items-center gap-2 px-3 py-2 text-xs"
              >
                <span className="w-6 shrink-0 text-center font-mono text-[11px] text-muted-foreground">
                  {idx + 1}
                </span>
                <span className="min-w-0 flex-1 truncate">{t.name}</span>
                {!t.is_active && <Badge tone="muted">archived</Badge>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
