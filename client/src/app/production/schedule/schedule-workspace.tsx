"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CalendarDays,
  CalendarRange,
  CalendarSearch,
  ChevronLeft,
  ChevronRight,
  Factory,
  GitBranch,
  Loader2,
  Settings2,
} from "lucide-react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  shiftManufacturingOrderAction,
  shiftProjectAction,
  updateManufacturingOrderStepAction,
} from "@/lib/production/actions";
import { invalidateAudit } from "@/lib/audit/invalidator";
import type { ProductionScheduleResponse } from "@/lib/production/types";
import { MODurationEditor } from "./mo-duration-editor";
import {
  ScheduleScaleContext,
  ZOOM_LABELS,
  ZOOM_LEVELS,
  addDays,
  buildTimeScale,
  fmtRangeLabel,
  isoDate,
  rangeForZoom,
  type ZoomLevel,
} from "./schedule-shared";
import { MOView, rowsFromOps, type MORow } from "./schedule-view-mo";
import { WorkstationView } from "./schedule-view-workstation";
import {
  ProjectView,
  projectRowsFromOps,
  type ProjectRow,
} from "./schedule-view-project";

interface Site {
  id: number;
  uuid: string;
  name: string;
}

interface Props {
  sites: Site[];
  canEditSteps: boolean;
}

type ScheduleView = "mo" | "workstation" | "project";

const VIEW_STORAGE_KEY = "production.schedule.view";
const ZOOM_STORAGE_KEY = "production.schedule.zoom";

function readStoredView(): ScheduleView {
  if (typeof window === "undefined") return "mo";
  const v = window.localStorage.getItem(VIEW_STORAGE_KEY);
  if (v === "mo" || v === "workstation" || v === "project") return v;
  return "mo";
}

function readStoredZoom(): ZoomLevel {
  if (typeof window === "undefined") return "week";
  const raw = window.localStorage.getItem(ZOOM_STORAGE_KEY);
  if (raw === "day" || raw === "week" || raw === "month") return raw;
  return "week";
}

export function ScheduleWorkspace({ sites, canEditSteps }: Props) {
  const router = useRouter();
  const [siteId, setSiteId] = useState<number>(sites[0]?.id ?? 0);
  const [view, setView] = useState<ScheduleView>("mo");
  const [zoom, setZoom] = useState<ZoomLevel>("week");
  // Anchor date — the workspace snaps it to the appropriate boundary
  // per zoom level (start of day / Monday / 4-week block) when
  // computing the visible range.
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [data, setData] = useState<ProductionScheduleResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [editingMoUuid, setEditingMoUuid] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Restore persisted prefs on mount.
  useEffect(() => {
    setView(readStoredView());
    setZoom(readStoredZoom());
  }, []);

  function chooseView(v: ScheduleView) {
    setView(v);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(VIEW_STORAGE_KEY, v);
    }
  }

  function chooseZoom(z: ZoomLevel) {
    setZoom(z);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ZOOM_STORAGE_KEY, z);
    }
  }

  const { rangeStart, rangeEnd } = useMemo(
    () => rangeForZoom(zoom, anchor),
    [zoom, anchor],
  );

  const scale = useMemo(() => buildTimeScale(zoom, rangeStart), [zoom, rangeStart]);

  const reload = useCallback(async () => {
    if (!siteId) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        warehouse_id: String(siteId),
        from: isoDate(rangeStart),
        to: isoDate(addDays(rangeEnd, -1)),
      }).toString();
      const res = await fetch(`/api/production/schedule?${qs}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setData(null);
        return;
      }
      const body = (await res.json()) as ProductionScheduleResponse;
      setData(body);
    } finally {
      setLoading(false);
    }
  }, [siteId, rangeStart, rangeEnd]);

  useEffect(() => {
    reload();
  }, [reload]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const moRows = useMemo<MORow[]>(
    () => (data ? rowsFromOps(data.operations) : []),
    [data],
  );

  const projectRows = useMemo<ProjectRow[]>(() => {
    if (!data) return [];
    const parentIds = new Map<number, number | null>();
    const meta = new Map<
      number,
      {
        code: string | null;
        uuid: string;
        itemName: string;
        status: string;
        qty: string;
      }
    >();
    for (const op of data.operations) {
      const mo = op.manufacturing_order;
      if (!mo) continue;
      parentIds.set(mo.id, mo.parent_mo_id ?? null);
      meta.set(mo.id, {
        code: mo.code,
        uuid: mo.uuid,
        itemName: mo.item?.name ?? "—",
        status: mo.status,
        qty: mo.quantity,
      });
    }
    return projectRowsFromOps(data.operations, parentIds, meta);
  }, [data]);

  function handleDragEnd(event: DragEndEvent) {
    if (!canEditSteps || !data) return;
    const { active, delta, over } = event;
    const idStr = String(active.id);

    // Pixels → milliseconds via the active zoom level.
    const msDelta = Math.round(delta.x / scale.preset.pxPerMs);
    const secondsDelta = Math.round(msDelta / 1000);

    if (idStr.startsWith("mo-")) {
      const uuid = idStr.slice("mo-".length);
      const row = moRows.find((r) => r.moUuid === uuid);
      if (!row || secondsDelta === 0) return;

      startTransition(async () => {
        const res = await shiftManufacturingOrderAction(uuid, secondsDelta);
        if (res.ok) {
          toast.success("Schedule updated");
          invalidateAudit("manufacturing_order", row.moId);
          router.refresh();
          await reload();
        } else {
          toast.error(res.detail);
          await reload();
        }
      });
      return;
    }

    if (idStr.startsWith("project-")) {
      const uuid = idStr.slice("project-".length);
      const row = projectRows.find((r) => r.rootMoUuid === uuid);
      if (!row || secondsDelta === 0) return;

      startTransition(async () => {
        const res = await shiftProjectAction(uuid, secondsDelta);
        if (res.ok) {
          toast.success("Project rescheduled");
          invalidateAudit("manufacturing_order", row.rootMoId);
          router.refresh();
          await reload();
        } else {
          toast.error(res.detail);
          await reload();
        }
      });
      return;
    }

    if (idStr.startsWith("op-")) {
      const opId = Number(idStr.slice("op-".length));
      const op = data.operations.find((o) => o.id === opId);
      if (!op || !op.planned_start || !op.planned_finish) return;
      const newStart = new Date(
        new Date(op.planned_start).getTime() + msDelta,
      ).toISOString();
      const newFinish = new Date(
        new Date(op.planned_finish).getTime() + msDelta,
      ).toISOString();

      let newWsgId = op.workstation_group_id;
      if (over) {
        const overId = String(over.id);
        if (overId.startsWith("wsg-")) {
          newWsgId = Number(overId.slice("wsg-".length));
        }
      }

      const moUuid = op.manufacturing_order?.uuid;
      if (!moUuid) return;

      startTransition(async () => {
        const res = await updateManufacturingOrderStepAction(moUuid, op.uuid, {
          planned_start: newStart,
          planned_finish: newFinish,
          workstation_group_id: newWsgId ?? undefined,
        });
        if (res.ok) {
          toast.success("Operation updated");
          invalidateAudit("manufacturing_order_step", op.id);
          router.refresh();
          await reload();
        } else {
          toast.error(res.detail);
          await reload();
        }
      });
    }
  }

  const editingRow = useMemo(
    () => moRows.find((r) => r.moUuid === editingMoUuid) ?? null,
    [moRows, editingMoUuid],
  );

  // Navigation step depends on the zoom — prev/next moves by the
  // range's width so the next page shows the next 1/7/28 days.
  function stepRange(direction: -1 | 1) {
    const days = direction * scale.preset.rangeDays;
    setAnchor((a) => addDays(a, days));
  }

  function goToday() {
    setAnchor(new Date());
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Site</span>
          <Select
            value={String(siteId)}
            onValueChange={(v) => setSiteId(Number(v))}
          >
            <SelectTrigger className="h-9 w-[18rem]">
              <SelectValue placeholder="Pick a site" />
            </SelectTrigger>
            <SelectContent>
              {sites.map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <ViewPicker view={view} onChange={chooseView} />

        <ZoomPicker zoom={zoom} onChange={chooseZoom} />

        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => stepRange(-1)}
            aria-label="Previous range"
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={goToday}
          >
            Today
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => stepRange(1)}
            aria-label="Next range"
          >
            <ChevronRight className="size-3.5" />
          </Button>
          <span className="ml-3 text-sm font-medium text-foreground">
            {fmtRangeLabel(scale)}
          </span>
          {loading && (
            <Loader2 className="ml-2 size-3.5 animate-spin text-muted-foreground" />
          )}
        </div>
      </div>

      {!data ? (
        <div className="rounded-md border border-border/60 bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
          {loading ? "Loading…" : "No data yet."}
        </div>
      ) : (
        <ScheduleScaleContext.Provider value={scale}>
          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            {view === "mo" &&
              (moRows.length === 0 ? (
                <EmptyState message="No approved manufacturing orders scheduled in this range." />
              ) : (
                <MOView
                  data={data}
                  rows={moRows}
                  canEditSteps={canEditSteps}
                  onEdit={(uuid) => setEditingMoUuid(uuid)}
                />
              ))}
            {view === "workstation" &&
              (data.workstation_groups.length === 0 ? (
                <EmptyState message="No workstation groups configured." />
              ) : (
                <WorkstationView
                  data={data}
                  canEditSteps={canEditSteps}
                  onEdit={(uuid) => setEditingMoUuid(uuid)}
                />
              ))}
            {view === "project" &&
              (projectRows.length === 0 ? (
                <EmptyState message="No active projects in this range." />
              ) : (
                <ProjectView
                  data={data}
                  rows={projectRows}
                  canEditSteps={canEditSteps}
                  onEdit={(uuid) => setEditingMoUuid(uuid)}
                />
              ))}
          </DndContext>
        </ScheduleScaleContext.Provider>
      )}

      {editingRow && data && (
        <MODurationEditor
          row={editingRow}
          workstationGroups={data.workstation_groups}
          onClose={() => setEditingMoUuid(null)}
          onSaved={async () => {
            setEditingMoUuid(null);
            await reload();
            router.refresh();
          }}
        />
      )}
    </section>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

function ViewPicker({
  view,
  onChange,
}: {
  view: ScheduleView;
  onChange: (v: ScheduleView) => void;
}) {
  const options: { id: ScheduleView; label: string; icon: typeof Factory }[] = [
    { id: "mo", label: "By MO", icon: Factory },
    { id: "workstation", label: "By workstation", icon: Settings2 },
    { id: "project", label: "By project", icon: GitBranch },
  ];

  return (
    <div className="inline-flex items-center rounded-md border border-border/60 p-0.5">
      {options.map((o) => {
        const Icon = o.icon;
        const active = view === o.id;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            aria-pressed={active}
            className={cn(
              "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function ZoomPicker({
  zoom,
  onChange,
}: {
  zoom: ZoomLevel;
  onChange: (z: ZoomLevel) => void;
}) {
  const icons: Record<ZoomLevel, typeof CalendarDays> = {
    day: CalendarSearch,
    week: CalendarDays,
    month: CalendarRange,
  };

  return (
    <div className="inline-flex items-center rounded-md border border-border/60 p-0.5">
      {ZOOM_LEVELS.map((z) => {
        const Icon = icons[z];
        const active = z === zoom;
        return (
          <button
            key={z}
            type="button"
            onClick={() => onChange(z)}
            aria-pressed={active}
            className={cn(
              "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" />
            {ZOOM_LABELS[z]}
          </button>
        );
      })}
    </div>
  );
}
