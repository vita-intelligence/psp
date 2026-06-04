"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
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
import { ErrorBanner } from "@/components/forms/error-banner";
import { FieldError } from "@/components/forms/field-error";
import { createFloorAction } from "@/lib/floors/actions";
import type { ErrorResult } from "@/lib/errors/server";
import { Loader2, Plus } from "lucide-react";

interface NewFloorButtonProps {
  warehouseUuid: string;
  /** Suggested name for the first floor so the dialog can pre-fill
   *  with something sensible. The user can change it. */
  suggestedName?: string;
}

export function NewFloorButton({
  warehouseUuid,
  suggestedName = "Ground floor",
}: NewFloorButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(suggestedName);
  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();

  function reset() {
    setName(suggestedName);
    setActionError(null);
    setFieldErrors({});
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setActionError(null);
    setFieldErrors({});

    startTransition(async () => {
      const res = await createFloorAction(warehouseUuid, { name: name.trim() });
      if (res.ok) {
        toast.success("Floor added", {
          description: `Created "${res.floor.name}".`,
        });
        setOpen(false);
        reset();
        router.refresh();
        return;
      }
      setFieldErrors(res.fields ?? {});
      setActionError(res);
    });
  }

  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        <Plus className="mr-1.5 size-4" />
        Add floor
      </Button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New floor</DialogTitle>
            <DialogDescription>
              Each floor has its own plan and storage locations.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="floor-name" className="text-sm font-medium">
                Floor name
              </Label>
              <Input
                id="floor-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Ground floor, Mezzanine, Cold room"
                maxLength={80}
                autoFocus
                disabled={pending}
              />
              <FieldError messages={fieldErrors.name} />
            </div>

            {actionError &&
              (!actionError.fields ||
                Object.keys(actionError.fields).length === 0) && (
                <ErrorBanner
                  detail={actionError.detail}
                  code={actionError.code}
                  debug={actionError.debug}
                />
              )}

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !name.trim()}>
                {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
                Create floor
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
