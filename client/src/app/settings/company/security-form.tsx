"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, LockKeyhole, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
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
import { CollabAvatars } from "@/components/realtime/collab-avatars";
import { FieldEditingIndicator } from "@/components/realtime/field-editing-indicator";
import { RemoteCursor } from "@/components/realtime/remote-cursor";
import { useLiveForm } from "@/lib/realtime/use-live-form";
import { useFormPresenceBeacon } from "@/lib/realtime/use-form-presence-beacon";
import { updateCompanySecurityAction } from "@/lib/company/actions";
import { ErrorBanner } from "@/components/forms/error-banner";
import type { Company } from "@/lib/types";
import type { ErrorResult } from "@/lib/errors/server";
import {
  CreatorLockBanner,
  JoinErrorCard,
  useFormCursorAnchor,
} from "./_realtime";

interface SecurityFormProps {
  company: Company;
  canEdit: boolean;
}

interface FormState {
  require_mfa: boolean;
}

function initialFrom(company: Company): FormState {
  return { require_mfa: company.require_mfa };
}

/**
 * Company-wide MFA-required toggle. Flipping ON stamps
 * `mfa_required_at` on every un-enrolled user's row so the
 * 7-day grace window starts ticking; past the deadline, their
 * login is refused until they enroll.
 *
 * Flipping OFF clears the grace stamps. Already-enrolled users
 * keep MFA active — disabling is a per-user action from Profile.
 */
export function SecurityForm({ company, canEdit }: SecurityFormProps) {
  useFormPresenceBeacon("company:1:security");

  const {
    state: form,
    setField,
    resetState,
    presence,
    fieldEditors,
    focusField,
    blurField,
    joinError,
    creator,
    isCreator,
    cursors,
    setCursor,
    hideCursor,
    broadcastCommit,
  } = useLiveForm<FormState>({
    resource: `company:${company.id}:security`,
    disabled: !canEdit,
    initialState: initialFrom(company),
    onCommit: (raw) => {
      const msg = raw as { kind: "security:saved"; state: FormState } | null;
      if (!msg || msg.kind !== "security:saved") return;
      toast.success("Saved", {
        description: `${creator?.name ?? "The host"} just saved the security policy.`,
      });
      setOriginal(msg.state);
      resetState(msg.state);
    },
  });

  const [original, setOriginal] = useState<FormState>(() => initialFrom(company));
  useEffect(() => {
    setOriginal(initialFrom(company));
  }, [company]);

  const [confirmOn, setConfirmOn] = useState(false);
  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = form.require_mfa !== original.require_mfa;

  function persist() {
    startTransition(async () => {
      const res = await updateCompanySecurityAction({
        require_mfa: form.require_mfa,
      });
      if (res.ok) {
        toast.success(
          form.require_mfa
            ? "MFA required for everyone"
            : "MFA is now optional",
          {
            description: form.require_mfa
              ? "Users without MFA have 7 days to enroll before login refuses."
              : "Existing MFA setups stay active — users can disable from their profile.",
          },
        );
        setOriginal(form);
        broadcastCommit({ kind: "security:saved", state: form });
        return;
      }
      setActionError(res);
    });
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canEdit || !isCreator || !dirty) return;
    setActionError(null);

    // Turning ON is disruptive (kicks non-enrolled users to enroll
    // within 7 days). Ask before flipping. Turning OFF just saves.
    if (form.require_mfa) {
      setConfirmOn(true);
      return;
    }
    persist();
  }

  function onReset() {
    resetState(original);
    setActionError(null);
  }

  const {
    attach: attachCursor,
    size: cursorSize,
    onMouseMove: onCursorMove,
    onMouseLeave: onCursorLeave,
  } = useFormCursorAnchor(setCursor, hideCursor);

  if (joinError) return <JoinErrorCard error={joinError} />;

  const fieldId = "security_require_mfa";

  return (
    <>
      <Card
        ref={attachCursor}
        onMouseMove={onCursorMove}
        onMouseLeave={onCursorLeave}
        className="relative border-border/60"
      >
        <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden rounded-xl">
          {Object.entries(cursors).map(([id, cursor]) => (
            <RemoteCursor
              key={id}
              cursor={cursor}
              anchorWidth={cursorSize.w}
              anchorHeight={cursorSize.h}
            />
          ))}
        </div>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="space-y-1.5">
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="size-4" />
                Security policy
              </CardTitle>
              <CardDescription>
                Require every user to sign in with a second factor (an
                authenticator app code) on top of their password.
              </CardDescription>
            </div>
            <div className="flex items-center gap-3">
              <CollabAvatars peers={presence} />
              {!canEdit && (
                <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                  <LockKeyhole className="size-3" />
                  Read-only
                </span>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <fieldset disabled={!canEdit || pending} className="contents">
            <form onSubmit={onSubmit} noValidate className="space-y-5">
              <div className="flex items-start justify-between gap-4 rounded-md border border-border/60 bg-muted/20 p-4">
                <div className="min-w-0 space-y-1">
                  <Label htmlFor={fieldId} className="text-sm font-medium">
                    Require MFA for everyone
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Un-enrolled users get 7 days from the moment this
                    turns on to add an authenticator. After that, login
                    refuses without a code.
                  </p>
                </div>
                <div className="relative flex items-center pt-1">
                  <Switch
                    id={fieldId}
                    checked={form.require_mfa}
                    onCheckedChange={(v) => setField("require_mfa", v)}
                    onFocus={() => focusField(fieldId)}
                    onBlur={() => blurField(fieldId)}
                    disabled={!canEdit || !isCreator || pending}
                  />
                  <FieldEditingIndicator peer={fieldEditors[fieldId]} />
                </div>
              </div>

              {actionError && (
                <ErrorBanner
                  detail={actionError.detail}
                  code={actionError.code}
                  debug={actionError.debug}
                />
              )}

              {canEdit && (
                <>
                  {!isCreator && <CreatorLockBanner creator={creator} />}
                  <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                    {dirty && !pending && isCreator && (
                      <Button type="button" variant="ghost" onClick={onReset}>
                        Discard
                      </Button>
                    )}
                    <Button
                      type="submit"
                      disabled={!dirty || pending || !isCreator}
                      title={
                        isCreator
                          ? undefined
                          : creator
                            ? `Only ${creator.name} can save from this room.`
                            : undefined
                      }
                    >
                      {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
                      Save changes
                    </Button>
                  </div>
                </>
              )}
            </form>
          </fieldset>
        </CardContent>
      </Card>

      <AlertDialog open={confirmOn} onOpenChange={setConfirmOn}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <div className="mb-2 flex size-12 items-center justify-center rounded-full bg-brand/10">
              <ShieldCheck className="size-6 text-brand" />
            </div>
            <AlertDialogTitle>Require MFA for everyone?</AlertDialogTitle>
            <AlertDialogDescription>
              Every user in the company gets a 7-day countdown to add
              an authenticator app. After that, login refuses without
              a code. Users who already have MFA stay signed in.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOn(false);
                persist();
              }}
            >
              Turn it on
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
