"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import type { Holiday } from "@/lib/company/bags";
import type { Company } from "@/lib/types";
import { ErrorBanner } from "@/components/forms/error-banner";
import type { ErrorResult } from "@/lib/errors/server";
import {
  CalendarOff,
  Loader2,
  LockKeyhole,
  Plus,
  Trash2,
} from "lucide-react";
import {
  CreatorLockBanner,
  JoinErrorCard,
  useFormCursorAnchor,
} from "./_realtime";

interface Props {
  company: Company;
  canEdit: boolean;
}

interface FormState {
  items: Holiday[];
}

function normalize(input: unknown): Holiday[] {
  const bag = (input ?? {}) as { items?: unknown };
  const items = Array.isArray(bag.items) ? bag.items : [];
  return items
    .filter(
      (i): i is Holiday =>
        typeof i === "object" &&
        i !== null &&
        typeof (i as Holiday).date === "string",
    )
    .map((i) => ({ date: i.date, label: i.label ?? "" }));
}

function sortByDate(items: Holiday[]): Holiday[] {
  return [...items].sort((a, b) => a.date.localeCompare(b.date));
}

// Field prefix disambiguates focused-field broadcasts on the shared
// `form:company:1` channel.
const P = "holidays_";

export function HolidaysForm({ company, canEdit }: Props) {
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
    initialState: { items: normalize(company.holidays) },
    onCommit: (raw) => {
      const msg = raw as { kind: "holidays:saved"; items: Holiday[] } | null;
      if (!msg || msg.kind !== "holidays:saved") return;
      toast.success("Saved", {
        description: `${creator?.name ?? "The host"} just saved holidays.`,
      });
      setOriginal(msg.items);
      resetState({ items: msg.items });
    },
  });

  const items = state.items;
  const setItems = (next: Holiday[]) => setField("items", next);

  const [original, setOriginal] = useState<Holiday[]>(() =>
    normalize(company.holidays),
  );
  useEffect(() => {
    setOriginal(normalize(company.holidays));
  }, [company]);

  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = JSON.stringify(items) !== JSON.stringify(original);

  function addRow() {
    setItems([...items, { date: "", label: "" }]);
  }

  function remove(index: number) {
    setItems(items.filter((_, i) => i !== index));
  }

  function update(index: number, patch: Partial<Holiday>) {
    setItems(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canEdit || !isCreator) return;
    setActionError(null);

    // Drop blank rows so the saved bag stays tidy.
    const cleaned = sortByDate(
      items
        .filter((i) => i.date.trim().length > 0)
        .map((i) => ({
          date: i.date,
          ...(i.label && i.label.trim().length > 0 ? { label: i.label.trim() } : {}),
        })),
    );

    startTransition(async () => {
      const res = await updateCompanyBagAction("holidays", { items: cleaned });
      if (res.ok) {
        toast.success("Holidays updated");
        setOriginal(cleaned);
        setField("items", cleaned);
        broadcastCommit({ kind: "holidays:saved", items: cleaned });
        return;
      }
      setActionError(res);
    });
  }

  function onReset() {
    resetState({ items: original });
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
            <CardTitle>Holidays</CardTitle>
            <CardDescription>
              Days when production is closed. Scheduling skips them automatically.
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
          <form onSubmit={onSubmit} className="space-y-4">
            {items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border/60 py-8 text-center">
                <CalendarOff className="size-6 text-muted-foreground" />
                <p className="text-sm font-medium">No holidays yet</p>
                <p className="text-xs text-muted-foreground">
                  Add the dates production is closed.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border/60 rounded-md border border-border/60">
                <li className="grid grid-cols-[1fr_1fr_auto] items-center gap-3 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <span>Date</span>
                  <span>Label (optional)</span>
                  <span className="sr-only">Actions</span>
                </li>
                {items.map((item, i) => {
                  const dateId = `${P}${i}_date`;
                  const labelId = `${P}${i}_label`;
                  return (
                    <li
                      key={i}
                      className="grid grid-cols-[1fr_1fr_auto] items-center gap-3 px-4 py-2"
                    >
                      <div className="relative">
                        <Input
                          id={dateId}
                          type="date"
                          value={item.date}
                          onChange={(e) => update(i, { date: e.target.value })}
                          onFocus={() => focusField(dateId)}
                          onBlur={() => blurField(dateId)}
                          className="h-10"
                          aria-label="Date"
                        />
                        <FieldEditingIndicator peer={fieldEditors[dateId]} />
                      </div>
                      <div className="relative">
                        <Input
                          id={labelId}
                          type="text"
                          placeholder="e.g. Christmas Day"
                          value={item.label ?? ""}
                          onChange={(e) => update(i, { label: e.target.value })}
                          onFocus={() => focusField(labelId)}
                          onBlur={() => blurField(labelId)}
                          maxLength={120}
                          className="h-10"
                          aria-label="Label"
                        />
                        <FieldEditingIndicator peer={fieldEditors[labelId]} />
                      </div>
                      {canEdit && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => remove(i)}
                          disabled={!isCreator}
                          className="size-9 text-muted-foreground hover:text-destructive"
                          aria-label="Remove holiday"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {canEdit && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addRow}
                disabled={!isCreator}
              >
                <Plus className="mr-1.5 size-4" />
                Add holiday
              </Button>
            )}

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
