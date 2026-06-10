"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CheckCircle2,
  CircleDashed,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge-mini";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorBanner } from "@/components/forms/error-banner";
import type { Vendor, VendorApprovalStatus } from "@/lib/types";
import type { ErrorDebug } from "@/lib/errors/types";
import { approveVendorAction } from "@/lib/vendors/actions";

interface Props {
  vendor: Vendor;
  canApprove: boolean;
}

const APPROVAL_LABEL: Record<VendorApprovalStatus, string> = {
  approved: "Approved",
  pending: "Pending",
  suspended: "Suspended",
  rejected: "Rejected",
};

const APPROVAL_TONE: Record<
  VendorApprovalStatus,
  "emerald" | "amber" | "muted" | "destructive"
> = {
  approved: "emerald",
  pending: "amber",
  suspended: "muted",
  rejected: "destructive",
};

const APPROVAL_ICON: Record<
  VendorApprovalStatus,
  typeof ShieldCheck
> = {
  approved: ShieldCheck,
  pending: CircleDashed,
  suspended: ShieldAlert,
  rejected: ShieldX,
};

/**
 * Approval workflow card. Shows the current state + who/when, and a
 * button (gated on `vendors.approve`) that opens a dialog to transition
 * to a new status. ESIGN columns get stamped backend-side on the
 * "approved" branch.
 */
export function VendorApprovalCard({ vendor, canApprove }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<{
    detail: string;
    code?: string;
    debug?: ErrorDebug;
  } | null>(null);

  const [status, setStatus] = useState<VendorApprovalStatus>(
    vendor.approval_status,
  );
  const [notes, setNotes] = useState(vendor.approval_notes ?? "");

  function reset() {
    setStatus(vendor.approval_status);
    setNotes(vendor.approval_notes ?? "");
    setError(null);
  }

  function submit() {
    if (status === vendor.approval_status && notes === (vendor.approval_notes ?? "")) {
      setOpen(false);
      return;
    }

    setError(null);
    startTransition(async () => {
      const res = await approveVendorAction(vendor.uuid, {
        approval_status: status,
        approval_notes: notes.trim() || null,
      });
      if (res.ok) {
        toast.success(`Approval set to ${APPROVAL_LABEL[status]}`);
        setOpen(false);
        router.refresh();
      } else {
        setError({ detail: res.detail, code: res.code, debug: res.debug });
      }
    });
  }

  const Icon = APPROVAL_ICON[vendor.approval_status];

  return (
    <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <header className="flex items-center gap-2">
            <Icon className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold tracking-tight">
              Qualification status
            </h2>
            <Badge tone={APPROVAL_TONE[vendor.approval_status]}>
              {APPROVAL_LABEL[vendor.approval_status]}
            </Badge>
          </header>
          {vendor.approved_at && vendor.approved_by ? (
            <p className="text-xs text-muted-foreground">
              {APPROVAL_LABEL[vendor.approval_status]} by{" "}
              <span className="font-medium text-foreground">
                {vendor.approved_by.name}
              </span>{" "}
              on {new Date(vendor.approved_at).toLocaleDateString()}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {vendor.approval_status === "pending"
                ? "Awaiting qualification review."
                : APPROVAL_LABEL[vendor.approval_status]}
            </p>
          )}
          {vendor.approval_notes && (
            <p className="rounded-md border border-border/40 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              {vendor.approval_notes}
            </p>
          )}
        </div>
        {canApprove && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              reset();
              setOpen(true);
            }}
          >
            <CheckCircle2 className="mr-1.5 size-4" />
            Change status
          </Button>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Update vendor approval</DialogTitle>
            <DialogDescription>
              Approving stamps your name + the current time as the
              qualification signature.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                New status
              </Label>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as VendorApprovalStatus)}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(
                    [
                      "pending",
                      "approved",
                      "suspended",
                      "rejected",
                    ] as VendorApprovalStatus[]
                  ).map((s) => (
                    <SelectItem key={s} value={s}>
                      {APPROVAL_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Notes
              </Label>
              <Textarea
                rows={4}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="What did the review find?"
              />
            </div>

            {error && (
              <ErrorBanner
                detail={error.detail}
                code={error.code}
                debug={error.debug}
              />
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
