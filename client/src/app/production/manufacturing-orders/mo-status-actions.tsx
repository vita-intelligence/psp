"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/forms/error-banner";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  CircleSlash,
  Loader2,
  Play,
  RotateCcw,
  ThumbsUp,
} from "lucide-react";
import { useState } from "react";
import { invalidateAudit } from "@/lib/audit/invalidator";
import { transitionManufacturingOrderAction } from "@/lib/production/actions";
import type {
  ManufacturingOrder,
  ManufacturingOrderStatus,
} from "@/lib/production/types";

interface Props {
  mo: ManufacturingOrder;
  canApprove: boolean;
  canExecute: boolean;
}

interface Action {
  label: string;
  toStatus: ManufacturingOrderStatus;
  icon: typeof Play;
  variant?: "default" | "outline" | "ghost";
  destructive?: boolean;
  requires: "approve" | "execute";
}

const ACTIONS_BY_STATUS: Record<ManufacturingOrderStatus, Action[]> = {
  draft: [
    {
      label: "Approve",
      toStatus: "approved",
      icon: ThumbsUp,
      requires: "approve",
    },
    {
      label: "Cancel",
      toStatus: "cancelled",
      icon: CircleSlash,
      variant: "ghost",
      destructive: true,
      requires: "execute",
    },
  ],
  approved: [
    {
      label: "Start",
      toStatus: "in_progress",
      icon: Play,
      requires: "execute",
    },
    {
      label: "Amend",
      toStatus: "draft",
      icon: RotateCcw,
      variant: "outline",
      requires: "approve",
    },
    {
      label: "Cancel",
      toStatus: "cancelled",
      icon: CircleSlash,
      variant: "ghost",
      destructive: true,
      requires: "execute",
    },
  ],
  in_progress: [
    {
      label: "Complete",
      toStatus: "completed",
      icon: CheckCircle2,
      requires: "execute",
    },
    {
      label: "Cancel",
      toStatus: "cancelled",
      icon: CircleSlash,
      variant: "ghost",
      destructive: true,
      requires: "execute",
    },
  ],
  completed: [],
  cancelled: [],
};

const STATUS_STYLES: Record<
  ManufacturingOrderStatus,
  { ring: string; bg: string; text: string; dot: string }
> = {
  draft: {
    ring: "ring-border",
    bg: "bg-muted/60",
    text: "text-muted-foreground",
    dot: "bg-muted-foreground/50",
  },
  approved: {
    ring: "ring-indigo-200 dark:ring-indigo-900/50",
    bg: "bg-indigo-50 dark:bg-indigo-950/30",
    text: "text-indigo-700 dark:text-indigo-300",
    dot: "bg-indigo-500",
  },
  in_progress: {
    ring: "ring-amber-200 dark:ring-amber-900/50",
    bg: "bg-amber-50 dark:bg-amber-950/30",
    text: "text-amber-800 dark:text-amber-300",
    dot: "bg-amber-500 animate-pulse",
  },
  completed: {
    ring: "ring-emerald-200 dark:ring-emerald-900/50",
    bg: "bg-emerald-50 dark:bg-emerald-950/30",
    text: "text-emerald-700 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  cancelled: {
    ring: "ring-destructive/30",
    bg: "bg-destructive/10",
    text: "text-destructive",
    dot: "bg-destructive",
  },
};

const STATUS_LABEL: Record<ManufacturingOrderStatus, string> = {
  draft: "Draft",
  approved: "Approved",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

export function MOStatusActions({ mo, canApprove, canExecute }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{
    detail: string;
    code?: string;
  } | null>(null);

  const actions = ACTIONS_BY_STATUS[mo.status].filter((a) =>
    a.requires === "approve" ? canApprove : canExecute,
  );

  function run(action: Action) {
    if (action.destructive) {
      if (!window.confirm(`Move this MO to "${action.toStatus}"?`)) return;
    }
    setActionError(null);
    setPendingLabel(action.label);
    startTransition(async () => {
      const res = await transitionManufacturingOrderAction(
        mo.uuid,
        action.toStatus,
      );
      setPendingLabel(null);
      if (res.ok) {
        toast.success(`Status → ${STATUS_LABEL[res.mo.status]}`);
        invalidateAudit("manufacturing_order", mo.id);
        router.refresh();
      } else {
        setActionError({ detail: res.detail, code: res.code });
      }
    });
  }

  const style = STATUS_STYLES[mo.status];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset",
            style.bg,
            style.text,
            style.ring,
          )}
        >
          <span className={cn("size-1.5 rounded-full", style.dot)} />
          {STATUS_LABEL[mo.status]}
        </span>

        {mo.blocking_children_count > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900/50">
            <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" aria-hidden />
            Waiting on {mo.blocking_children_count} sub-MO
            {mo.blocking_children_count === 1 ? "" : "s"}
          </span>
        )}

        {mo.parent_mo && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200 dark:bg-indigo-950/30 dark:text-indigo-300 dark:ring-indigo-900/50">
            <span className="size-1.5 rounded-full bg-indigo-500" aria-hidden />
            Feeds {mo.parent_mo.code ?? `MO #${mo.parent_mo.id}`}
          </span>
        )}

        {actions.length > 0 && (
          <span className="h-5 w-px bg-border" aria-hidden />
        )}

        {actions.map((a) => {
          const Icon = a.icon;
          const isThisPending = pending && pendingLabel === a.label;
          return (
            <Button
              key={a.label}
              type="button"
              size="sm"
              variant={a.variant ?? "default"}
              disabled={pending}
              onClick={() => run(a)}
              className={
                a.destructive
                  ? "text-destructive hover:bg-destructive/10 hover:text-destructive"
                  : undefined
              }
            >
              {isThisPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Icon className="size-3.5" />
              )}
              {a.label}
            </Button>
          );
        })}
        {actions.length === 0 &&
          mo.status !== "completed" &&
          mo.status !== "cancelled" && (
            <span className="text-xs text-muted-foreground">
              Ask an admin for the right permission to transition status.
            </span>
          )}
      </div>
      {actionError && (
        <ErrorBanner detail={actionError.detail} code={actionError.code} />
      )}
    </div>
  );
}
