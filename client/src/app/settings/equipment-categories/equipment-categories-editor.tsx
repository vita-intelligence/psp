"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge-mini";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ErrorBanner } from "@/components/forms/error-banner";
import type { ErrorResult } from "@/lib/errors/server";
import type { EquipmentCategory } from "@/lib/equipment/types";
import {
  createEquipmentCategoryAction,
  deleteEquipmentCategoryAction,
  updateEquipmentCategoryAction,
} from "@/lib/equipment/actions";

interface Props {
  initial: EquipmentCategory[];
  canEdit: boolean;
}

interface AddState {
  name: string;
  notes: string;
  usefulLifeYears: string;
  calibrationMonths: string;
  maintenanceMonths: string;
}

const EMPTY_ADD: AddState = {
  name: "",
  notes: "",
  usefulLifeYears: "",
  calibrationMonths: "",
  maintenanceMonths: "",
};

function toIntOrNull(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

export function EquipmentCategoriesEditor({ initial, canEdit }: Props) {
  const [rows, setRows] = useState<EquipmentCategory[]>(initial);
  const [add, setAdd] = useState<AddState>(EMPTY_ADD);
  const [error, setError] = useState<ErrorResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [rowPendingId, setRowPendingId] = useState<number | null>(null);

  const activeCount = useMemo(
    () => rows.filter((r) => r.is_active).length,
    [rows],
  );

  function handleCreate() {
    setError(null);
    const name = add.name.trim();
    if (!name) {
      toast.error("Category name is required.");
      return;
    }

    startTransition(async () => {
      const res = await createEquipmentCategoryAction({
        name,
        notes: add.notes.trim() || null,
        default_useful_life_years: toIntOrNull(add.usefulLifeYears),
        default_calibration_frequency_months: toIntOrNull(add.calibrationMonths),
        default_maintenance_frequency_months: toIntOrNull(add.maintenanceMonths),
      });
      if (!res.ok) {
        setError(res);
        return;
      }
      setRows((prev) => [res.category, ...prev]);
      setAdd(EMPTY_ADD);
      toast.success(`Category "${res.category.name}" added.`);
    });
  }

  function handleDeactivate(cat: EquipmentCategory) {
    setError(null);
    setRowPendingId(cat.id);
    startTransition(async () => {
      const res = await deleteEquipmentCategoryAction(cat.uuid);
      setRowPendingId(null);
      if (!res.ok) {
        setError(res);
        return;
      }
      setRows((prev) =>
        prev.map((r) => (r.id === res.category.id ? res.category : r)),
      );
      toast.success(`"${res.category.name}" archived.`);
    });
  }

  function handleReactivate(cat: EquipmentCategory) {
    setError(null);
    setRowPendingId(cat.id);
    startTransition(async () => {
      const res = await updateEquipmentCategoryAction(cat.uuid, {
        is_active: true,
      });
      setRowPendingId(null);
      if (!res.ok) {
        setError(res);
        return;
      }
      setRows((prev) =>
        prev.map((r) => (r.id === res.category.id ? res.category : r)),
      );
      toast.success(`"${res.category.name}" reactivated.`);
    });
  }

  return (
    <div className="space-y-6">
      {error && (
        <ErrorBanner
          detail={error.detail}
          code={error.code}
          debug={error.debug}
        />
      )}

      {canEdit && (
        <div className="rounded-md border bg-muted/30 p-4">
          <h3 className="mb-3 text-sm font-medium">Add a new category</h3>
          <div className="grid gap-3 md:grid-cols-6">
            <div className="md:col-span-2">
              <Label htmlFor="cat-name" className="text-xs">
                Name
              </Label>
              <Input
                id="cat-name"
                value={add.name}
                onChange={(e) =>
                  setAdd((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder="Mixers"
                disabled={pending}
                maxLength={120}
              />
            </div>
            <div>
              <Label htmlFor="cat-useful" className="text-xs">
                Useful life (yrs)
              </Label>
              <Input
                id="cat-useful"
                type="number"
                min={1}
                value={add.usefulLifeYears}
                onChange={(e) =>
                  setAdd((prev) => ({
                    ...prev,
                    usefulLifeYears: e.target.value,
                  }))
                }
                placeholder="10"
                disabled={pending}
              />
            </div>
            <div>
              <Label htmlFor="cat-cal" className="text-xs">
                Calibration (mo)
              </Label>
              <Input
                id="cat-cal"
                type="number"
                min={1}
                value={add.calibrationMonths}
                onChange={(e) =>
                  setAdd((prev) => ({
                    ...prev,
                    calibrationMonths: e.target.value,
                  }))
                }
                placeholder="12"
                disabled={pending}
              />
            </div>
            <div>
              <Label htmlFor="cat-maint" className="text-xs">
                Maintenance (mo)
              </Label>
              <Input
                id="cat-maint"
                type="number"
                min={1}
                value={add.maintenanceMonths}
                onChange={(e) =>
                  setAdd((prev) => ({
                    ...prev,
                    maintenanceMonths: e.target.value,
                  }))
                }
                placeholder="6"
                disabled={pending}
              />
            </div>
            <div className="flex items-end">
              <Button
                type="button"
                onClick={handleCreate}
                disabled={pending || !add.name.trim()}
                className="w-full"
              >
                {pending && rowPendingId === null ? (
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                ) : (
                  <Plus className="mr-1.5 size-4" />
                )}
                Add
              </Button>
            </div>
          </div>
          <div className="mt-3">
            <Label htmlFor="cat-notes" className="text-xs">
              Notes (optional)
            </Label>
            <Textarea
              id="cat-notes"
              value={add.notes}
              onChange={(e) =>
                setAdd((prev) => ({ ...prev, notes: e.target.value }))
              }
              placeholder="What's grouped in this category, or notable defaults?"
              rows={2}
              disabled={pending}
            />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Defaults auto-populate on new equipment rows in this category —
            operators can still override per unit.
          </p>
        </div>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {activeCount} active · {rows.length - activeCount} archived
          </p>
        </div>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Useful life</TableHead>
                <TableHead className="text-right">Calibration</TableHead>
                <TableHead className="text-right">Maintenance</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-6 text-center text-sm text-muted-foreground"
                  >
                    No equipment categories yet — add one above to start
                    grouping physical assets.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((cat) => {
                const busy = rowPendingId === cat.id;
                return (
                  <TableRow
                    key={cat.id}
                    className={cat.is_active ? "" : "opacity-60"}
                  >
                    <TableCell className="max-w-[280px]">
                      <div className="font-medium">{cat.name}</div>
                      {cat.notes && (
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">
                          {cat.notes}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {cat.default_useful_life_years
                        ? `${cat.default_useful_life_years} yr`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {cat.default_calibration_frequency_months
                        ? `${cat.default_calibration_frequency_months} mo`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {cat.default_maintenance_frequency_months
                        ? `${cat.default_maintenance_frequency_months} mo`
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {cat.is_active ? (
                        <Badge tone="emerald">Active</Badge>
                      ) : (
                        <Badge tone="muted">Archived</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {canEdit &&
                        (cat.is_active ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeactivate(cat)}
                            disabled={busy}
                          >
                            {busy ? (
                              <Loader2 className="mr-1 size-4 animate-spin" />
                            ) : (
                              <Trash2 className="mr-1 size-4" />
                            )}
                            Archive
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleReactivate(cat)}
                            disabled={busy}
                          >
                            {busy ? (
                              <Loader2 className="mr-1 size-4 animate-spin" />
                            ) : (
                              <RotateCcw className="mr-1 size-4" />
                            )}
                            Reactivate
                          </Button>
                        ))}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
