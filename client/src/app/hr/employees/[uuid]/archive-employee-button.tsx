"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Archive, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { archiveHREmployeeAction } from "@/lib/hr/actions";

/** Soft-delete only — sessions FK the row so we never hard-delete.
 *  Sets `is_active = false` + stamps `termination_date = today`. */
export function ArchiveEmployeeButton({
  uuid,
  name,
  disabled,
}: {
  uuid: string;
  name: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onConfirm() {
    startTransition(async () => {
      const res = await archiveHREmployeeAction(uuid);
      if (res.ok) {
        toast.success(`${name} archived`);
        setOpen(false);
        router.push("/hr/employees");
        router.refresh();
      } else {
        toast.error(res.detail || "Couldn't archive the employee.");
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="text-muted-foreground hover:text-destructive"
      >
        <Archive className="mr-1.5 size-4" />
        Archive
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <div className="mb-2 flex size-12 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="size-6 text-destructive" />
            </div>
            <AlertDialogTitle>Archive {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Marks the employee as archived and stamps today as the
              termination date. Historic sessions and cost breakdowns
              still resolve — we never hard-delete an operator record.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onConfirm}
              disabled={pending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Archive employee
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
