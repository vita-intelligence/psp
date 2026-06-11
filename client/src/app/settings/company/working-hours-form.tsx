"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CollabAvatars } from "@/components/realtime/collab-avatars";
import { FieldEditingIndicator } from "@/components/realtime/field-editing-indicator";
import { RemoteCursor } from "@/components/realtime/remote-cursor";
import { useLiveForm } from "@/lib/realtime/use-live-form";
import { useFormPresenceBeacon } from "@/lib/realtime/use-form-presence-beacon";
import { updateCompanyBagAction } from "@/lib/company/bag-actions";
import { ErrorBanner } from "@/components/forms/error-banner";
import type { ErrorResult } from "@/lib/errors/server";
import {
  WEEKDAYS,
  WEEKDAY_LABELS,
  type Weekday,
  type DayHours,
  type WorkingHours,
} from "@/lib/company/bags";
import type { Company } from "@/lib/types";
import { Loader2, LockKeyhole } from "lucide-react";
import {
  CreatorLockBanner,
  JoinErrorCard,
  useFormCursorAnchor,
} from "./_realtime";

interface Props {
  company: Company;
  canEdit: boolean;
}

const EMPTY_DAY: DayHours = { opens_at: null, closes_at: null };

type FormState = Record<Weekday, DayHours>;

function normalize(input: unknown): FormState {
  const safe = (input ?? {}) as Record<string, unknown>;
  return WEEKDAYS.reduce((acc, day) => {
    const v = safe[day];
    if (v && typeof v === "object") {
      const entry = v as Partial<DayHours>;
      acc[day] = {
        opens_at: entry.opens_at ?? null,
        closes_at: entry.closes_at ?? null,
      };
    } else {
      acc[day] = { ...EMPTY_DAY };
    }
    return acc;
  }, {} as FormState);
}

// Field prefix disambiguates focused-field broadcasts on the shared
// `form:company:1` channel. Per-day inputs end up `working_hours_<day>_opens`
// / `_closes` so peers know which cell you're typing in.
const P = "working_hours_";

export function WorkingHoursForm({ company, canEdit }: Props) {
  useFormPresenceBeacon("company:1");

  const {
    state,
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
    resource: "company:1",
    disabled: !canEdit,
    initialState: normalize(company.working_hours),
    onCommit: (raw) => {
      const msg = raw as { kind: "working_hours:saved"; state: FormState } | null;
      if (!msg || msg.kind !== "working_hours:saved") return;
      toast.success("Saved", {
        description: `${creator?.name ?? "The host"} just saved working hours.`,
      });
      setOriginal(msg.state);
      resetState(msg.state);
    },
  });

  const [original, setOriginal] = useState<FormState>(() =>
    normalize(company.working_hours),
  );
  useEffect(() => {
    setOriginal(normalize(company.working_hours));
  }, [company]);

  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = JSON.stringify(state) !== JSON.stringify(original);

  function updateDay(day: Weekday, field: keyof DayHours, value: string) {
    setField(day, { ...state[day], [field]: value || null });
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canEdit || !isCreator) return;
    setActionError(null);

    // Trim closed days to null, drop daily rows that are entirely empty
    // so the stored bag is clean.
    const cleaned: WorkingHours = {};
    for (const day of WEEKDAYS) {
      const v = state[day];
      if (v.opens_at && v.closes_at) {
        cleaned[day] = v;
      } else {
        cleaned[day] = null;
      }
    }

    startTransition(async () => {
      const res = await updateCompanyBagAction("working_hours", cleaned);
      if (res.ok) {
        toast.success("Working hours updated");
        const next = normalize(cleaned);
        setOriginal(next);
        broadcastCommit({ kind: "working_hours:saved", state: next });
        return;
      }
      setActionError(res);
    });
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

  return (
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
            <CardTitle>Working hours</CardTitle>
            <CardDescription>
              Days and hours your operations run. Leave a day blank to mark it as closed.
            </CardDescription>
          </div>
          <div className="flex items-center gap-3">
            <CollabAvatars peers={presence} />
            {!canEdit && <ReadOnly />}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <fieldset disabled={!canEdit || pending} className="contents">
          <form onSubmit={onSubmit} className="space-y-3">
            {WEEKDAYS.map((day) => {
              const opensId = `${P}${day}_opens`;
              const closesId = `${P}${day}_closes`;
              return (
                <div
                  key={day}
                  className="grid grid-cols-[100px_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-4"
                >
                  <Label htmlFor={opensId} className="text-sm font-medium">
                    {WEEKDAY_LABELS[day]}
                  </Label>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Input
                        id={opensId}
                        type="time"
                        value={state[day].opens_at ?? ""}
                        onChange={(e) =>
                          updateDay(day, "opens_at", e.target.value)
                        }
                        onFocus={() => focusField(opensId)}
                        onBlur={() => blurField(opensId)}
                        className="h-10 max-w-[120px]"
                        aria-label={`${WEEKDAY_LABELS[day]} opens at`}
                      />
                      <FieldEditingIndicator peer={fieldEditors[opensId]} />
                    </div>
                    <span aria-hidden className="text-muted-foreground">
                      –
                    </span>
                    <div className="relative">
                      <Input
                        id={closesId}
                        type="time"
                        value={state[day].closes_at ?? ""}
                        onChange={(e) =>
                          updateDay(day, "closes_at", e.target.value)
                        }
                        onFocus={() => focusField(closesId)}
                        onBlur={() => blurField(closesId)}
                        className="h-10 max-w-[120px]"
                        aria-label={`${WEEKDAY_LABELS[day]} closes at`}
                      />
                      <FieldEditingIndicator peer={fieldEditors[closesId]} />
                    </div>
                  </div>
                </div>
              );
            })}

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
                <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-end">
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
  );
}

function ReadOnly() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
      <LockKeyhole className="size-3" />
      Read-only
    </span>
  );
}
