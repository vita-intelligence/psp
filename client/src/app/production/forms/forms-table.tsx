"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { Loader2, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge-mini";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  archiveFormTemplateAction,
  reactivateFormTemplateAction,
} from "@/lib/forms/actions";
import {
  TRIGGER_LABELS,
  type FormTemplate,
  type FormTrigger,
} from "@/lib/forms/types";

interface Props {
  initial: FormTemplate[];
  canEdit: boolean;
}

type TriggerFilter = "all" | FormTrigger;

const TRIGGER_TONE: Record<FormTrigger, "sky" | "amber" | "emerald"> = {
  workstation_start: "sky",
  workstation_end: "amber",
  cleaning: "emerald",
};

export function FormsTable({ initial, canEdit }: Props) {
  const [rows, setRows] = useState<FormTemplate[]>(initial);
  const [search, setSearch] = useState("");
  const [triggerFilter, setTriggerFilter] = useState<TriggerFilter>("all");
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState<ErrorResult | null>(null);
  const [rowPendingId, setRowPendingId] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (!showArchived && !r.is_active) return false;
      if (triggerFilter !== "all" && r.trigger !== triggerFilter) return false;
      if (q && !r.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, triggerFilter, showArchived]);

  const activeCount = useMemo(
    () => rows.filter((r) => r.is_active).length,
    [rows],
  );

  function handleArchive(row: FormTemplate) {
    setError(null);
    setRowPendingId(row.id);
    startTransition(async () => {
      const res = await archiveFormTemplateAction(row.uuid);
      setRowPendingId(null);
      if (!res.ok) {
        setError(res);
        return;
      }
      setRows((prev) =>
        prev.map((r) => (r.id === res.form_template.id ? res.form_template : r)),
      );
      toast.success(`"${res.form_template.name}" archived.`);
    });
  }

  function handleReactivate(row: FormTemplate) {
    setError(null);
    setRowPendingId(row.id);
    startTransition(async () => {
      const res = await reactivateFormTemplateAction(row.uuid);
      setRowPendingId(null);
      if (!res.ok) {
        setError(res);
        return;
      }
      setRows((prev) =>
        prev.map((r) => (r.id === res.form_template.id ? res.form_template : r)),
      );
      toast.success(`"${res.form_template.name}" reactivated.`);
    });
  }

  return (
    <div className="space-y-4">
      {error && (
        <ErrorBanner
          detail={error.detail}
          code={error.code}
          debug={error.debug}
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name"
          className="max-w-xs"
        />
        <Select
          value={triggerFilter}
          onValueChange={(v) => setTriggerFilter(v as TriggerFilter)}
        >
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All triggers</SelectItem>
            <SelectItem value="workstation_start">Workstation start</SelectItem>
            <SelectItem value="workstation_end">Workstation end</SelectItem>
            <SelectItem value="cleaning">Cleaning</SelectItem>
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant={showArchived ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setShowArchived((v) => !v)}
        >
          {showArchived ? "Hiding none" : "Show archived"}
        </Button>
        <p className="ml-auto text-xs text-muted-foreground">
          {activeCount} active · {rows.length - activeCount} archived
        </p>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Trigger</TableHead>
              <TableHead className="text-right">Version</TableHead>
              <TableHead>Publish state</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-6 text-center text-sm text-muted-foreground"
                >
                  {rows.length === 0
                    ? canEdit
                      ? "No forms yet — click New form to author your first checklist."
                      : "No forms have been authored yet."
                    : "No forms match your filters."}
                </TableCell>
              </TableRow>
            )}
            {filtered.map((row) => {
              const busy = rowPendingId === row.id;
              const pubLabel = row.last_published_at
                ? row.dirty_since_publish
                  ? `v${row.last_published_version ?? "?"} · unpublished changes`
                  : `Published ${formatDistanceToNow(new Date(row.last_published_at), { addSuffix: true })}`
                : "Never published";
              return (
                <TableRow
                  key={row.id}
                  className={row.is_active ? "" : "opacity-60"}
                >
                  <TableCell className="max-w-[360px]">
                    <Link
                      href={`/production/forms/${row.uuid}`}
                      className="font-medium hover:underline"
                    >
                      {row.name}
                    </Link>
                    {row.description && (
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        {row.description}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge tone={TRIGGER_TONE[row.trigger]}>
                      {TRIGGER_LABELS[row.trigger]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    v{row.version}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {pubLabel}
                  </TableCell>
                  <TableCell>
                    {row.is_active ? (
                      <Badge tone="emerald">Active</Badge>
                    ) : (
                      <Badge tone="muted">Archived</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {canEdit &&
                      (row.is_active ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleArchive(row)}
                          disabled={busy || pending}
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
                          onClick={() => handleReactivate(row)}
                          disabled={busy || pending}
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
  );
}
