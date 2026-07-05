"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { ErrorBanner } from "@/components/forms/error-banner";
import { revokeOtherSessionsAction } from "@/lib/auth/profile-actions";
import type { ErrorResult } from "@/lib/errors/server";
import { Loader2, LogOut, ShieldAlert } from "lucide-react";

/**
 * "Log out other devices" — bumps the user's token_version on the
 * backend, which invalidates every session token issued for them
 * except a freshly-minted one for this browser tab.
 *
 * Useful when the user notices a stray "I forgot to log out of the
 * office desktop" or worse. No password change required.
 */
export function SessionsCard() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [pending, startTransition] = useTransition();

  function onConfirmed() {
    setConfirmOpen(false);
    setActionError(null);
    startTransition(async () => {
      const res = await revokeOtherSessionsAction();
      if (res.ok) {
        toast.success("Other devices signed out", {
          description:
            "Every other tab, phone, or tablet signed in as you is now logged out.",
        });
        return;
      }
      setActionError(res);
    });
  }

  return (
    <>
      <Card className="border-border/60">
        <CardHeader>
          <CardTitle>Sessions</CardTitle>
          <CardDescription>
            If you notice a device you don't recognise, or you forgot
            to sign out somewhere, kick it off here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {actionError && (
            <ErrorBanner
              detail={actionError.detail}
              code={actionError.code}
              debug={actionError.debug}
            />
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/60 bg-muted/20 p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">Sign out other devices</p>
              <p className="text-xs text-muted-foreground">
                This browser stays signed in. Every other session
                (phones, tablets, other browsers) is logged out on
                their next request.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setConfirmOpen(true)}
            >
              {pending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <LogOut className="mr-2 size-4" />
              )}
              Sign out other devices
            </Button>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <div className="mb-2 flex size-12 items-center justify-center rounded-full bg-amber-500/10">
              <ShieldAlert className="size-6 text-amber-600 dark:text-amber-400" />
            </div>
            <AlertDialogTitle>Sign out other devices?</AlertDialogTitle>
            <AlertDialogDescription>
              Every other browser, phone, and tablet signed in as you
              will be logged out on their next request. You'll stay
              signed in on this device.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmed}>
              Yes, sign them out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
