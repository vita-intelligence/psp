import Link from "next/link";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCompanyDate, formatCompanyMoney } from "@/lib/format/company";
import { format as formatDateFns } from "date-fns";
import type { CompanyDefaults } from "@/lib/types";
import type { ManufacturingOrder } from "@/lib/production/types";

interface Props {
  mo: ManufacturingOrder;
  company: CompanyDefaults;
  canEdit: boolean;
}

/**
 * MRPEasy-style operations table — one row per routing step.
 * Planned start / finish come from the BE (MO start + accumulated
 * setup + cycle×qty), so the schedule preview matches whatever the
 * routing actually configures. Actual start/finish + cost columns
 * are placeholders until the execution layer ships.
 */
export function MOOperationsTable({ mo, company, canEdit }: Props) {
  if (mo.operations.length === 0) {
    return (
      <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
        <header className="mb-3">
          <h2 className="text-sm font-semibold tracking-tight">Operations</h2>
        </header>
        <p className="text-xs text-muted-foreground">
          {mo.routing
            ? "The connected routing has no steps yet."
            : "No routing attached to this MO — the schedule will run without operation-level timing."}
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-tight">Operations</h2>
        {mo.routing && (
          <p className="text-[11px] text-muted-foreground">
            Snapshotted from{" "}
            <span className="font-medium text-foreground">
              {mo.routing.code ?? mo.routing.name}
            </span>{" "}
            · click the pencil to modify any operation
          </p>
        )}
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[64rem] text-xs">
          <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 text-left">Operation</th>
              <th className="px-2 py-1.5 text-left">Workstation</th>
              <th className="px-2 py-1.5 text-left">Planned start</th>
              <th className="px-2 py-1.5 text-left">Planned finish</th>
              <th className="px-2 py-1.5 text-left">Worker</th>
              <th className="px-2 py-1.5 text-left">Actual start</th>
              <th className="px-2 py-1.5 text-left">Actual finish</th>
              <th className="px-2 py-1.5 text-right">Labor cost</th>
              <th className="w-8 px-2 py-1.5" aria-label="Edit" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {mo.operations.map((op) => (
              <tr key={op.id}>
                <td className="px-2 py-1.5 max-w-[24rem]">
                  <p className="whitespace-pre-line text-xs">
                    {op.operation_description ?? (
                      <span className="text-muted-foreground/60">
                        (no description)
                      </span>
                    )}
                  </p>
                </td>
                <td className="px-2 py-1.5">
                  {op.workstation_group ? (
                    <div className="flex items-center gap-1.5">
                      {op.workstation_group.color && (
                        <span
                          aria-hidden
                          className="size-2.5 shrink-0 rounded-sm border border-border/60"
                          style={{ backgroundColor: op.workstation_group.color }}
                        />
                      )}
                      <span className="text-xs">
                        {op.workstation_group.name}
                      </span>
                    </div>
                  ) : (
                    <span className="text-muted-foreground/50">—</span>
                  )}
                </td>
                <td className="px-2 py-1.5">
                  {op.planned_start ? (
                    <span className="font-mono text-[11px]">
                      {formatCompanyDate(op.planned_start, company)}{" "}
                      {formatDateFns(new Date(op.planned_start), "HH:mm")}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/50">—</span>
                  )}
                </td>
                <td className="px-2 py-1.5">
                  {op.planned_finish ? (
                    <span className="font-mono text-[11px]">
                      {formatCompanyDate(op.planned_finish, company)}{" "}
                      {formatDateFns(new Date(op.planned_finish), "HH:mm")}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/50">—</span>
                  )}
                </td>
                <td className="px-2 py-1.5">
                  {op.workers.length === 0 ? (
                    <span className="text-muted-foreground/50">—</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {op.workers.map((w) => (
                        <span
                          key={w.id}
                          className="rounded-full bg-muted px-1.5 py-0.5 text-[10px]"
                        >
                          {w.name}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-2 py-1.5">
                  {op.actual_start ? (
                    <span className="font-mono text-[11px]">
                      {formatCompanyDate(op.actual_start, company)}{" "}
                      {formatDateFns(new Date(op.actual_start), "HH:mm")}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/50">—</span>
                  )}
                </td>
                <td className="px-2 py-1.5">
                  {op.actual_finish ? (
                    <span className="font-mono text-[11px]">
                      {formatCompanyDate(op.actual_finish, company)}{" "}
                      {formatDateFns(new Date(op.actual_finish), "HH:mm")}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/50">—</span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-right">
                  {op.labor_cost ? (
                    <span className="font-mono text-xs">
                      {formatCompanyMoney(op.labor_cost, company)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/50">—</span>
                  )}
                </td>
                <td className="px-1 py-1 text-right">
                  {canEdit && op.editable ? (
                    <Button
                      asChild
                      variant="ghost"
                      size="icon-xs"
                      className="text-muted-foreground hover:text-foreground"
                      aria-label="Modify operation"
                      title="Modify operation"
                    >
                      <Link
                        href={`/production/manufacturing-orders/${mo.uuid}/operations/${op.uuid}`}
                      >
                        <Pencil />
                      </Link>
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground">
        Actual times + labor cost land with the MO execution layer.
      </p>
    </section>
  );
}
