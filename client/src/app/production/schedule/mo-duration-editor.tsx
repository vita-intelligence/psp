"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateManufacturingOrderStepAction } from "@/lib/production/actions";
import { invalidateAudit } from "@/lib/audit/invalidator";
import type {
  ProductionScheduleResponse,
  ScheduleOperation,
} from "@/lib/production/types";
import { format as formatDateFns } from "date-fns";

interface Props {
  row: {
    moId: number;
    moUuid: string;
    moCode: string | null;
    itemName: string;
    qty: string;
    start: string;
    finish: string;
    steps: ScheduleOperation[];
  };
  workstationGroups: ProductionScheduleResponse["workstation_groups"];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

interface EditableStep {
  id: number;
  uuid: string;
  sort_order: number;
  workstation_group_id: number | null;
  description: string | null;
  setup_min: string;
  cycle_min: string;
  capacity: string;
  /** MO qty — for the duration formula. Pulled from the row, not
   *  edited here. */
  quantity: string;
}

/**
 * The block-level duration editor — opened by clicking an MO on the
 * production schedule. Each row in the editor is one operation step
 * with editable setup / cycle / capacity / workstation group. As the
 * operator types, the per-step duration + total + projected finish
 * recompute live. Save patches each step, then the calendar reloads
 * and the block grows.
 */
export function MODurationEditor({
  row,
  workstationGroups,
  onClose,
  onSaved,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [steps, setSteps] = useState<EditableStep[]>(() =>
    row.steps.map((s) => ({
      id: s.id,
      uuid: s.uuid,
      sort_order: s.sort_order,
      workstation_group_id: s.workstation_group_id,
      description: s.operation_description,
      // Backend doesn't carry setup/cycle/capacity in the schedule
      // payload (they live on the step row itself). Derive from the
      // planned duration as a starting display value — operator
      // overrides with the real numbers from the MO detail page when
      // they need precision. Setup defaults to 0, cycle = total
      // duration / qty, capacity = 1.
      setup_min: "0",
      cycle_min: computeCycleFromPlanned(s, Number(row.qty)),
      capacity: "1",
      quantity: row.qty,
    })),
  );

  const startDate = useMemo(() => new Date(row.start), [row.start]);

  // Live total in seconds.
  const totals = useMemo(() => {
    let sec = 0;
    const perStep: number[] = [];
    for (const s of steps) {
      const setup = Number(s.setup_min) || 0;
      const cycle = Number(s.cycle_min) || 0;
      const cap = Math.max(Number(s.capacity) || 1, 0.0001);
      const qty = Number(s.quantity) || 0;
      const stepSec = Math.ceil((setup + (cycle * qty) / cap) * 60);
      perStep.push(stepSec);
      sec += stepSec;
    }
    return { perStep, totalSec: sec };
  }, [steps]);

  const projectedFinish = useMemo(
    () => new Date(startDate.getTime() + totals.totalSec * 1000),
    [startDate, totals.totalSec],
  );

  function patchStep(idx: number, patch: Partial<EditableStep>) {
    setSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      // Recompute the chain from the MO start. Each step's
      // planned_start = previous step's planned_finish.
      let cursorMs = startDate.getTime();
      const updates = steps.map((s, i) => {
        const startIso = new Date(cursorMs).toISOString();
        const finishMs = cursorMs + totals.perStep[i] * 1000;
        const finishIso = new Date(finishMs).toISOString();
        cursorMs = finishMs;

        return {
          step: s,
          attrs: {
            planned_start: startIso,
            planned_finish: finishIso,
            workstation_group_id: s.workstation_group_id ?? undefined,
          },
        };
      });

      let allOk = true;
      for (const { step, attrs } of updates) {
        const res = await updateManufacturingOrderStepAction(
          row.moUuid,
          step.uuid,
          attrs,
        );
        if (!res.ok) {
          allOk = false;
          toast.error(`Step ${step.sort_order + 1}: ${res.detail}`);
          break;
        }
      }

      if (allOk) {
        toast.success(`Schedule updated · finishes ${formatDateFns(projectedFinish, "dd MMM HH:mm")}`);
        invalidateAudit("manufacturing_order", row.moId);
        await onSaved();
      }
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            Operations · {row.moCode ?? `MO #${row.moId}`}
          </DialogTitle>
          <DialogDescription>
            {row.itemName} · {row.qty} units · starts{" "}
            {formatDateFns(startDate, "EEE dd MMM yyyy HH:mm")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-3">
          <div className="overflow-x-auto rounded-md border border-border/60">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 text-left">#</th>
                  <th className="px-2 py-1.5 text-left">Workstation group</th>
                  <th className="px-2 py-1.5 text-right">Setup (min)</th>
                  <th className="px-2 py-1.5 text-right">Cycle / unit (min)</th>
                  <th className="px-2 py-1.5 text-right">Capacity</th>
                  <th className="px-2 py-1.5 text-right">Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {steps.map((s, idx) => {
                  const sec = totals.perStep[idx];
                  const hours = Math.floor(sec / 3600);
                  const mins = Math.round((sec % 3600) / 60);
                  return (
                    <tr key={s.id}>
                      <td className="px-2 py-1.5 font-mono text-[10px]">
                        {s.sort_order + 1}
                      </td>
                      <td className="px-2 py-1.5">
                        <Select
                          value={String(s.workstation_group_id ?? "")}
                          onValueChange={(v) =>
                            patchStep(idx, {
                              workstation_group_id: v ? Number(v) : null,
                            })
                          }
                        >
                          <SelectTrigger className="h-8 min-w-[12rem] text-xs">
                            <SelectValue placeholder="Pick a group" />
                          </SelectTrigger>
                          <SelectContent>
                            {workstationGroups.map((g) => (
                              <SelectItem key={g.id} value={String(g.id)}>
                                {g.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {s.description && (
                          <p className="mt-1 truncate text-[10px] text-muted-foreground">
                            {s.description}
                          </p>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          value={s.setup_min}
                          onChange={(e) =>
                            patchStep(idx, { setup_min: e.target.value })
                          }
                          inputMode="decimal"
                          className="h-8 max-w-[6rem] font-mono text-xs"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          value={s.cycle_min}
                          onChange={(e) =>
                            patchStep(idx, { cycle_min: e.target.value })
                          }
                          inputMode="decimal"
                          className="h-8 max-w-[6rem] font-mono text-xs"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          value={s.capacity}
                          onChange={(e) =>
                            patchStep(idx, { capacity: e.target.value })
                          }
                          inputMode="decimal"
                          className="h-8 max-w-[6rem] font-mono text-xs"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono">
                        {hours > 0 ? `${hours}h ` : ""}
                        {mins}m
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-muted/30 text-[11px]">
                <tr>
                  <td colSpan={5} className="px-2 py-2 text-right font-medium">
                    Total
                  </td>
                  <td className="px-2 py-2 text-right font-mono font-semibold">
                    {Math.floor(totals.totalSec / 3600)}h{" "}
                    {Math.round((totals.totalSec % 3600) / 60)}m
                  </td>
                </tr>
                <tr>
                  <td colSpan={5} className="px-2 py-2 text-right text-muted-foreground">
                    Projected finish
                  </td>
                  <td className="px-2 py-2 text-right font-mono">
                    {formatDateFns(projectedFinish, "EEE dd MMM HH:mm")}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Each step&apos;s duration ={" "}
            <span className="font-mono">
              ceil(setup + cycle × qty ÷ capacity) min
            </span>
            . Start stays fixed; finish moves out as you increase
            durations and the block grows on the calendar.
          </p>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Save schedule
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function computeCycleFromPlanned(
  step: ScheduleOperation,
  qty: number,
): string {
  if (!step.planned_start || !step.planned_finish || qty <= 0) return "0";
  const ms =
    new Date(step.planned_finish).getTime() - new Date(step.planned_start).getTime();
  if (ms <= 0) return "0";
  const minPerUnit = ms / 60000 / qty;
  return minPerUnit.toFixed(3);
}
