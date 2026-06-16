"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge-mini";
import { ErrorBanner } from "@/components/forms/error-banner";
import {
  CheckCircle2,
  CircleSlash,
  Loader2,
  Play,
  RotateCcw,
  Sparkles,
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
      icon: Sparkles,
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

const STATUS_TONE: Record<
  ManufacturingOrderStatus,
  "muted" | "amber" | "emerald" | "destructive"
> = {
  draft: "muted",
  approved: "amber",
  in_progress: "amber",
  completed: "emerald",
  cancelled: "destructive",
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

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={STATUS_TONE[mo.status]}>{STATUS_LABEL[mo.status]}</Badge>
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
                  ? "text-destructive hover:bg-destructive/10"
                  : undefined
              }
            >
              {isThisPending ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <Icon className="mr-1.5 size-3.5" />
              )}
              {a.label}
            </Button>
          );
        })}
        {actions.length === 0 && mo.status !== "completed" && mo.status !== "cancelled" && (
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
