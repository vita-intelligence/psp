"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, LockKeyhole, FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FieldError } from "@/components/forms/field-error";
import { CollabAvatars } from "@/components/realtime/collab-avatars";
import { FieldEditingIndicator } from "@/components/realtime/field-editing-indicator";
import { RemoteCursor } from "@/components/realtime/remote-cursor";
import { CellPicker } from "@/components/forms/cell-picker";
import { useLiveForm } from "@/lib/realtime/use-live-form";
import { useFormPresenceBeacon } from "@/lib/realtime/use-form-presence-beacon";
import { updateCompanyRdConsumptionCellAction } from "@/lib/company/actions";
import { ErrorBanner } from "@/components/forms/error-banner";
import type { Company, StockCellPickerRow } from "@/lib/types";
import type { FieldErrors } from "@/lib/auth/actions";
import type { ErrorResult } from "@/lib/errors/server";
import {
  CreatorLockBanner,
  JoinErrorCard,
  useFormCursorAnchor,
} from "./_realtime";

interface RdConsumptionCellFormProps {
  company: Company;
  canEdit: boolean;
}

interface FormState {
  // string for select-style ergonomics — matches CellPicker's `value`
  // API. Empty string means "cleared".
  rd_consumption_cell_id: string;
}

function initialFrom(company: Company): FormState {
  return {
    rd_consumption_cell_id:
      company.rd_consumption_cell_id != null
        ? String(company.rd_consumption_cell_id)
        : "",
  };
}

const P = "rd_consumption_cell_";

export function RdConsumptionCellForm({
  company,
  canEdit,
}: RdConsumptionCellFormProps) {
  useFormPresenceBeacon("company:1");

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
    resource: "company:1:rd-consumption-cell",
    disabled: !canEdit,
    initialState: initialFrom(company),
    onCommit: (raw) => {
      const msg = raw as
        | { kind: "rd_consumption_cell:saved"; state: FormState }
        | null;
      if (!msg || msg.kind !== "rd_consumption_cell:saved") return;
      toast.success("Saved", {
        description: `${creator?.name ?? "The host"} just updated the R&D consumption cell.`,
      });
      setOriginal(msg.state);
      resetState(msg.state);
    },
  });

  const [original, setOriginal] = useState<FormState>(() =>
    initialFrom(company),
  );
  useEffect(() => {
    setOriginal(initialFrom(company));
  }, [company]);

  // Local breadcrumb — starts from the server-preloaded row and
  // updates on every pick so the trigger button stays informative
  // across search-clears without a refetch.
  const [selectedRow, setSelectedRow] = useState<StockCellPickerRow | null>(
    company.rd_consumption_cell,
  );
  useEffect(() => {
    setSelectedRow(company.rd_consumption_cell);
  }, [company]);

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = JSON.stringify(form) !== JSON.stringify(original);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canEdit || !isCreator) return;
    setFieldErrors({});
    setActionError(null);
    startTransition(async () => {
      const payload = {
        rd_consumption_cell_id:
          form.rd_consumption_cell_id === ""
            ? null
            : Number(form.rd_consumption_cell_id),
      };
      const res = await updateCompanyRdConsumptionCellAction(payload);
      if (res.ok) {
        toast.success("R&D consumption cell updated");
        setOriginal(form);
        broadcastCommit({ kind: "rd_consumption_cell:saved", state: form });
        return;
      }
      setFieldErrors(res.fields ?? {});
      setActionError(res);
    });
  }

  function onReset() {
    resetState(original);
    setSelectedRow(company.rd_consumption_cell);
    setFieldErrors({});
    setActionError(null);
  }

  const {
    attach: attachCursor,
    size: cursorSize,
    onMouseMove: onCursorMove,
    onMouseLeave: onCursorLeave,
  } = useFormCursorAnchor(setCursor, hideCursor);

  if (joinError) return <JoinErrorCard error={joinError} />;

  const fieldId = `${P}cell_picker`;
  const errors = fieldErrors.rd_consumption_cell_id;

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
            <CardTitle className="flex items-center gap-2">
              <FlaskConical className="size-4 text-muted-foreground" />
              R&amp;D consumption cell
            </CardTitle>
            <CardDescription>
              Default drop-off cell for trial-batch manufacturing orders
              (project type: trial or sample). When a scientist creates
              an MO from NPD, the warehouse picker&apos;s confirmed load
              lands here instead of the standard production-feed target.
              Leave empty if you don&apos;t run R&amp;D through PSP —
              trial MOs will fall through to the picker&apos;s manual cell
              choice.
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
            <div className="grid gap-2 sm:grid-cols-[260px_minmax(0,1fr)] sm:gap-4">
              <Label
                htmlFor={fieldId}
                className="pt-2.5 text-sm font-medium"
              >
                Cell
              </Label>
              <div
                className="space-y-1.5"
                onFocus={() => focusField(fieldId)}
                onBlur={() => blurField(fieldId)}
              >
                <div className="relative">
                  <CellPicker
                    value={form.rd_consumption_cell_id}
                    selected={selectedRow}
                    disabled={!canEdit || pending}
                    placeholder="Pick a cell for R&D consumption…"
                    matchTags={false}
                    onChange={(id, row) => {
                      setField("rd_consumption_cell_id", id);
                      setSelectedRow(row);
                    }}
                  />
                  <FieldEditingIndicator peer={fieldEditors[fieldId]} />
                </div>
                <p className="text-xs text-muted-foreground">
                  Tip: tag the destination cell with{" "}
                  <span className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                    rnd
                  </span>{" "}
                  in Warehouse settings so R&amp;D-only items land here
                  automatically on receive too — the tag also isolates
                  R&amp;D stock from production picks.
                </p>
                <FieldError messages={errors} />
              </div>
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
  );
}
