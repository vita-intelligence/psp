"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Calendar, PackageCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  bookAllPartsAction,
  type BookingStrategy,
} from "@/lib/production/actions";
import { invalidateAudit } from "@/lib/audit/invalidator";
import type { ManufacturingOrder } from "@/lib/production/types";

interface Props {
  mo: ManufacturingOrder;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface StrategyOption {
  key: BookingStrategy;
  label: string;
  oneLine: string;
  detail: string;
  icon: typeof Calendar;
}

const OPTIONS: StrategyOption[] = [
  {
    key: "fefo",
    label: "FEFO",
    oneLine: "First-expired, first-out",
    detail:
      "Allocate the lot closest to its expiry date first. Best for ingredients and anything with a shelf life — gets short-dated stock out before it expires.",
    icon: Calendar,
  },
  {
    key: "fifo",
    label: "FIFO",
    oneLine: "First-in, first-out",
    detail:
      "Allocate the oldest received lot first. Best for non-perishable stock — keeps inventory turning over in receipt order.",
    icon: PackageCheck,
  },
];

export function BookAllDialog({ mo, open, onOpenChange }: Props) {
  const router = useRouter();
  const [strategy, setStrategy] = useState<BookingStrategy>("fefo");
  const [pending, startTransition] = useTransition();

  function onConfirm() {
    startTransition(async () => {
      const res = await bookAllPartsAction(mo.uuid, strategy);
      if (res.ok) {
        toast.success(
          res.created === 0
            ? "Nothing more to book — already covered."
            : `${res.created} booking${res.created === 1 ? "" : "s"} created (${strategy.toUpperCase()}).`,
        );
        invalidateAudit("manufacturing_order", mo.id);
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(res.detail);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Book all parts</DialogTitle>
          <DialogDescription>
            Pick the allocation strategy. Lots eligible for booking get
            picked in this order until every BOM line is covered (or
            stock runs out).
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          {OPTIONS.map((o) => {
            const Icon = o.icon;
            const selected = strategy === o.key;
            return (
              <button
                key={o.key}
                type="button"
                onClick={() => setStrategy(o.key)}
                className={cn(
                  "flex items-start gap-3 rounded-md border px-3 py-3 text-left transition-colors",
                  selected
                    ? "border-brand bg-brand/5 ring-1 ring-brand"
                    : "border-border/60 hover:bg-muted/40",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md",
                    selected ? "bg-brand text-white" : "bg-muted text-muted-foreground",
                  )}
                >
                  <Icon className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="text-sm font-semibold">{o.label}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {o.oneLine}
                    </span>
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {o.detail}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm} disabled={pending}>
            {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
            Book using {strategy.toUpperCase()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
