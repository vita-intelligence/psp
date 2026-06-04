"use client";

import { useState } from "react";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { AuditHistoryCard } from "./audit-history-card";
import type { AuditEvent } from "@/lib/types";

interface AuditHistoryDialogProps {
  entityType: AuditEvent["entity_type"];
  entityId: number;
  /** Trigger label — defaults to a clock icon + "History". */
  triggerLabel?: string;
  /** Header inside the dialog so the operator knows what they're
   *  looking at when several panels nest. */
  title: string;
  description?: string;
  canRestore?: boolean;
  /** Pre-rendered trigger node — when set, replaces the default
   *  ghost button. Useful when the surrounding context already has
   *  a custom button style. */
  trigger?: React.ReactNode;
  /** Lift the open/close state out — useful when the dialog opens
   *  from a non-button source (e.g. a row in another widget). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Small Dialog wrapper around the existing AuditHistoryCard so the
 * history can be popped over any inline context (e.g. the selected
 * storage location or the active floor) without dedicating a whole
 * page to it.
 */
export function AuditHistoryDialog({
  entityType,
  entityId,
  triggerLabel = "History",
  title,
  description,
  canRestore,
  trigger,
  open: openProp,
  onOpenChange: onOpenChangeProp,
}: AuditHistoryDialogProps) {
  const [openLocal, setOpenLocal] = useState(false);
  const open = openProp ?? openLocal;
  const setOpen = onOpenChangeProp ?? setOpenLocal;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button type="button" variant="ghost" size="sm">
            <Clock className="mr-1.5 size-3.5" />
            {triggerLabel}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <AuditHistoryCard
          entityType={entityType}
          entityId={entityId}
          canRestore={canRestore}
        />
      </DialogContent>
    </Dialog>
  );
}
