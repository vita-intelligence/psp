"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertCircle,
  Loader2,
  Lock,
  LockKeyhole,
  Paperclip,
  Trash2,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CurrencyPicker } from "@/components/forms/currency-picker";
import { FieldError } from "@/components/forms/field-error";
import { ErrorBanner } from "@/components/forms/error-banner";
import { CollabAvatars } from "@/components/realtime/collab-avatars";
import { FieldEditingIndicator } from "@/components/realtime/field-editing-indicator";
import { RemoteCursor } from "@/components/realtime/remote-cursor";
import { useLiveForm } from "@/lib/realtime/use-live-form";
import { useFormPresenceBeacon } from "@/lib/realtime/use-form-presence-beacon";
import { cn } from "@/lib/utils";
import type { FieldErrors } from "@/lib/auth/actions";
import type { ErrorResult } from "@/lib/errors/server";
import type { ProcurementInvoice } from "@/lib/invoices/types";
import {
  attachInvoiceFileAction,
  createInvoiceAction,
  deleteInvoiceAction,
  detachInvoiceFileAction,
  updateInvoiceAction,
} from "@/lib/invoices/actions";

/** Form state shape — kept narrow so the collab channel doesn't ship
 *  unrelated baggage. Money fields stay as strings: the server-side
 *  changeset works in `Decimal`, and a string round-trips through
 *  Phoenix without precision loss. */
interface InvoiceFormState {
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  currency_code: string;
  subtotal: string;
  tax_amount: string;
  /** Read-only display value — auto-computed = subtotal + tax_amount.
   *  Lives in state so peers see the same derived total. */
  total_inc_tax: string;
  paid_amount: string;
  notes: string;
}

interface Props {
  /** When the form is editing an existing invoice. `null` for create. */
  invoice: ProcurementInvoice | null;
  /** The parent PO uuid — required on create (the route lives under
   *  `/api/purchase-orders/:po_uuid/invoices`). For edit it's the
   *  invoice's own `purchase_order?.uuid`. */
  poUuid: string;
  /** PO's default currency — pre-fills create form. Falls back to
   *  the company default if absent. */
  poCurrency: string;
  /** Company default currency (read from `/settings/company`). Used
   *  when the PO doesn't carry its own. */
  companyCurrency: string;
  canManage: boolean;
  /** When the form lives in a dialog, this closes it on a successful
   *  save / delete. Omit if the form is inline. */
  onDone?: () => void;
}

function emptyState(poCurrency: string, companyCurrency: string): InvoiceFormState {
  return {
    invoice_number: "",
    invoice_date: new Date().toISOString().slice(0, 10),
    due_date: "",
    currency_code: poCurrency || companyCurrency || "GBP",
    subtotal: "",
    tax_amount: "0",
    total_inc_tax: "",
    paid_amount: "0",
    notes: "",
  };
}

/** Strip trailing zeros from BE-serialised Decimal strings so inputs
 *  show "1400" instead of "1400.0000". Preserves user intent on edit
 *  (we don't reformat as the user types — only at initial render). */
function trim_money(value: string | null | undefined): string {
  if (value == null || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  // toFixed(2) then strip trailing zeros + trailing dot. Keeps 5
  // significant decimals if needed for forex rounding edge cases.
  const fixed = n.toFixed(2);
  return fixed.replace(/\.?0+$/, "") || "0";
}

function initialFrom(
  invoice: ProcurementInvoice | null,
  poCurrency: string,
  companyCurrency: string,
): InvoiceFormState {
  if (!invoice) return emptyState(poCurrency, companyCurrency);
  return {
    invoice_number: invoice.invoice_number ?? "",
    invoice_date: invoice.invoice_date ?? "",
    due_date: invoice.due_date ?? "",
    currency_code: invoice.currency_code ?? poCurrency ?? companyCurrency,
    subtotal: trim_money(invoice.subtotal),
    tax_amount: trim_money(invoice.tax_amount) || "0",
    total_inc_tax: trim_money(invoice.total_inc_tax),
    paid_amount: trim_money(invoice.paid_amount) || "0",
    notes: invoice.notes ?? "",
  };
}

/** Adds two decimal strings while preserving sane precision. Returns
 *  empty when either side is empty/unparseable — the form treats that
 *  as "user is still typing" and leaves the derived field blank. */
function deriveTotal(subtotal: string, tax: string): string {
  const a = Number(subtotal);
  const b = Number(tax || "0");
  if (!Number.isFinite(a) || !Number.isFinite(b)) return "";
  if (!subtotal.trim()) return "";
  const sum = a + b;
  return sum.toFixed(2);
}

/**
 * Canonical invoice edit / create form with realtime collab + the
 * head-of-room save gate. Renders inside a Card so it composes equally
 * well as the body of a Dialog (the PO detail Invoices card) or as a
 * page-level form.
 */
export function InvoiceForm({
  invoice,
  poUuid,
  poCurrency,
  companyCurrency,
  canManage,
  onDone,
}: Props) {
  const router = useRouter();
  // Channel resource shape — matches `can_edit_resource?("invoice", …)`
  // on the BE. Create mode uses `invoice:<po_uuid>:new` so peers on
  // the SAME PO converge into one drafting room; edit mode keys to
  // the invoice's own uuid.
  const resource = invoice
    ? `invoice:${invoice.uuid}`
    : `invoice:${poUuid}:new`;
  useFormPresenceBeacon(resource);

  type CommitPayload =
    | { kind: "created"; uuid: string; number: string }
    | { kind: "saved"; state: InvoiceFormState }
    | { kind: "deleted" };

  const initial = useMemo(
    () => initialFrom(invoice, poCurrency, companyCurrency),
    [invoice, poCurrency, companyCurrency],
  );

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
  } = useLiveForm<InvoiceFormState>({
    resource,
    disabled: !canManage,
    initialState: initial,
    onCommit: (raw) => {
      const msg = raw as CommitPayload | null;
      if (!msg) return;
      if (msg.kind === "created") {
        toast.success("Invoice added", {
          description: `${creator?.name ?? "The host"} added invoice ${msg.number}.`,
        });
        // Peer's PO detail page needs to pick up the new row.
        router.refresh();
        onDone?.();
      } else if (msg.kind === "saved") {
        toast.success("Invoice saved", {
          description: `${creator?.name ?? "The host"} saved the invoice.`,
        });
        setOriginal(msg.state);
        resetState(msg.state);
        router.refresh();
      } else if (msg.kind === "deleted") {
        toast.success("Invoice removed", {
          description: `${creator?.name ?? "The host"} deleted the invoice.`,
        });
        router.refresh();
        onDone?.();
      }
    },
  });

  // Cursor anchor + live remote-cursor overlay state — same pattern as
  // the canonical warehouse-form.
  const cursorAnchorRef = useRef<HTMLDivElement | null>(null);
  const [anchorSize, setAnchorSize] = useState<{ w: number; h: number }>({
    w: 0,
    h: 0,
  });

  useEffect(() => {
    const el = cursorAnchorRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setAnchorSize({ w: rect.width, h: rect.height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => hideCursor(), [hideCursor]);

  const onCursorMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = cursorAnchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      setCursor(x, y);
    },
    [setCursor],
  );

  const [original, setOriginal] = useState<InvoiceFormState>(initial);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [filePending, setFilePending] = useState(false);
  // Create-mode only: file gets staged client-side then uploaded after
  // the invoice row is created (the BE attach endpoint needs an uuid).
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  // Compute-don't-ask rule for `total_inc_tax`: derived from subtotal
  // + tax. We mirror the derived value into state so peers see it,
  // but mark the input read-only.
  useEffect(() => {
    const computed = deriveTotal(state.subtotal, state.tax_amount);
    if (computed !== state.total_inc_tax) {
      setField("total_inc_tax", computed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.subtotal, state.tax_amount]);

  const dirty = JSON.stringify(state) !== JSON.stringify(original);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isCreator) return;
    setFieldErrors({});
    setActionError(null);

    const payload = {
      invoice_number: state.invoice_number.trim(),
      invoice_date: state.invoice_date || null,
      due_date: state.due_date || null,
      currency_code: state.currency_code,
      subtotal: state.subtotal || "0",
      tax_amount: state.tax_amount || "0",
      total_inc_tax: state.total_inc_tax || "0",
      paid_amount: state.paid_amount || "0",
      notes: state.notes || null,
    };

    startTransition(async () => {
      const res = invoice
        ? await updateInvoiceAction(invoice.uuid, payload, poUuid)
        : await createInvoiceAction(poUuid, payload);

      if (res.ok) {
        // If the user staged a file alongside a brand-new invoice,
        // upload it now that the row exists. Failure here is non-
        // fatal: the row is already saved; we warn and let the user
        // retry from the edit dialog.
        if (!invoice && pendingFile) {
          const form = new FormData();
          form.append("file", pendingFile);
          const attachRes = await attachInvoiceFileAction(
            res.invoice.uuid,
            form,
            poUuid,
          );
          if (!attachRes.ok) {
            toast.warning(
              `Invoice ${res.invoice.invoice_number} saved, but the file couldn't attach. Open it to retry.`,
            );
          }
        }

        toast.success(invoice ? "Invoice saved" : "Invoice added");
        setOriginal(state);
        setPendingFile(null);
        if (invoice) {
          broadcastCommit({ kind: "saved", state });
        } else {
          broadcastCommit({
            kind: "created",
            uuid: res.invoice.uuid,
            number: res.invoice.invoice_number,
          });
        }
        router.refresh();
        onDone?.();
        return;
      }
      setFieldErrors(res.fields ?? {});
      setActionError(res);
    });
  }

  function onReset() {
    if (!isCreator) return;
    resetState(original);
    setFieldErrors({});
    setActionError(null);
  }

  function onDelete() {
    if (!invoice || !isCreator) return;
    if (
      !window.confirm(
        `Delete invoice ${invoice.invoice_number}? This can't be undone.`,
      )
    )
      return;
    startTransition(async () => {
      const res = await deleteInvoiceAction(invoice.uuid, poUuid);
      if (res.ok) {
        toast.success("Invoice deleted");
        broadcastCommit({ kind: "deleted" });
        router.refresh();
        onDone?.();
      } else {
        setActionError(res);
      }
    });
  }

  async function onFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !invoice) return;
    setFilePending(true);
    const form = new FormData();
    form.append("file", file);
    const res = await attachInvoiceFileAction(invoice.uuid, form, poUuid);
    setFilePending(false);
    if (res.ok) {
      toast.success("File attached");
      router.refresh();
    } else {
      setActionError(res);
    }
  }

  async function onFileDetach() {
    if (!invoice) return;
    setFilePending(true);
    const res = await detachInvoiceFileAction(invoice.uuid, poUuid);
    setFilePending(false);
    if (res.ok) {
      toast.success("File removed");
      router.refresh();
    } else {
      setActionError(res);
    }
  }

  if (joinError) {
    return <JoinErrorCard error={joinError} />;
  }

  return (
    <div
      ref={cursorAnchorRef}
      onMouseMove={onCursorMove}
      onMouseLeave={hideCursor}
      className="relative flex min-h-0 flex-1 flex-col"
    >
      {/* Remote-cursor overlay — anchored to the form root so cursors
          ride along inside the dialog. */}
      <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
        {Object.entries(cursors).map(([id, cursor]) => (
          <RemoteCursor
            key={id}
            cursor={cursor}
            anchorWidth={anchorSize.w}
            anchorHeight={anchorSize.h}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 px-5 py-4 sm:px-6">
        <div className="space-y-1">
          <h2 className="text-base font-semibold tracking-tight">
            {invoice
              ? `Edit invoice ${invoice.invoice_number}`
              : "Add invoice"}
          </h2>
          <p className="text-xs text-muted-foreground">
            {invoice
              ? "Update the AP record. Subtotal + tax must equal total inc. tax."
              : "Log a vendor invoice against this PO."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <CollabAvatars peers={presence} />
          {!canManage && (
            <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground">
              <LockKeyhole className="size-3" />
              Read-only
            </span>
          )}
        </div>
      </div>

      <fieldset
        disabled={!canManage || pending}
        className="contents [&>form]:flex [&>form]:min-h-0 [&>form]:flex-1 [&>form]:flex-col"
      >
        <form
          onSubmit={onSubmit}
          noValidate
          className="overscroll-contain"
        >
          <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6 space-y-6">
            <SectionHeader>Invoice details</SectionHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <CollabField
                id="invoice_number"
                label="Invoice number"
                required
                value={state.invoice_number}
                onChange={(v) => setField("invoice_number", v)}
                onFocus={focusField}
                onBlur={blurField}
                editor={fieldEditors.invoice_number}
                errors={fieldErrors.invoice_number}
                placeholder="INV-2026-0042"
                mono
              />
              <div className="space-y-1.5">
                <Label htmlFor="currency_code" className="text-xs font-medium">
                  Currency
                  <span className="ml-1 text-muted-foreground/60">•</span>
                </Label>
                <div className="relative">
                  <CurrencyPicker
                    id="currency_code"
                    value={state.currency_code}
                    onChange={(code) =>
                      setField("currency_code", code ?? state.currency_code)
                    }
                    onFocus={() => focusField("currency_code")}
                    onBlur={() => blurField("currency_code")}
                  />
                  <FieldEditingIndicator peer={fieldEditors.currency_code} />
                </div>
                <FieldError messages={fieldErrors.currency_code} />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <CollabField
                id="invoice_date"
                type="date"
                label="Invoice date"
                required
                value={state.invoice_date}
                onChange={(v) => setField("invoice_date", v)}
                onFocus={focusField}
                onBlur={blurField}
                editor={fieldEditors.invoice_date}
                errors={fieldErrors.invoice_date}
              />
              <CollabField
                id="due_date"
                type="date"
                label="Due date"
                value={state.due_date}
                onChange={(v) => setField("due_date", v)}
                onFocus={focusField}
                onBlur={blurField}
                editor={fieldEditors.due_date}
                errors={fieldErrors.due_date}
                hint="Overdue flag fires after this date."
              />
            </div>

            <SectionHeader>Amounts</SectionHeader>
            <div className="rounded-md border border-border/60 bg-muted/20 p-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <CollabField
                  id="subtotal"
                  label="Subtotal"
                  required
                  value={state.subtotal}
                  onChange={(v) => setField("subtotal", v)}
                  onFocus={focusField}
                  onBlur={blurField}
                  editor={fieldEditors.subtotal}
                  errors={fieldErrors.subtotal}
                  placeholder="0.00"
                  inputMode="decimal"
                  mono
                />
                <CollabField
                  id="tax_amount"
                  label="Tax"
                  required
                  value={state.tax_amount}
                  onChange={(v) => setField("tax_amount", v)}
                  onFocus={focusField}
                  onBlur={blurField}
                  editor={fieldEditors.tax_amount}
                  errors={fieldErrors.tax_amount}
                  placeholder="0.00"
                  inputMode="decimal"
                  mono
                />
              </div>
              <div className="flex flex-wrap items-baseline justify-between gap-3 border-t border-border/60 pt-3">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">
                  Total inc. tax
                </span>
                <span className="font-mono text-lg font-semibold tracking-tight">
                  {state.total_inc_tax || "0.00"}{" "}
                  <span className="text-sm text-muted-foreground">
                    {state.currency_code}
                  </span>
                </span>
              </div>
              <FieldError messages={fieldErrors.total_inc_tax} />
              <div className="grid gap-3 sm:grid-cols-2 pt-1">
                <CollabField
                  id="paid_amount"
                  label="Paid so far"
                  value={state.paid_amount}
                  onChange={(v) => setField("paid_amount", v)}
                  onFocus={focusField}
                  onBlur={blurField}
                  editor={fieldEditors.paid_amount}
                  errors={fieldErrors.paid_amount}
                  placeholder="0.00"
                  inputMode="decimal"
                  mono
                  hint="Cannot exceed the invoice total."
                />
              </div>
            </div>

            <SectionHeader>Paperwork</SectionHeader>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Vendor PDF</Label>
              {invoice && invoice.file ? (
                <div className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-xs">
                  <Paperclip className="size-3.5 text-emerald-700" />
                  <a
                    href={invoice.file.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 flex-1 truncate font-medium text-foreground underline-offset-2 hover:underline"
                    title={invoice.file.filename}
                  >
                    {invoice.file.filename}
                  </a>
                  <span className="text-muted-foreground">
                    {invoice.file.byte_size
                      ? `${(invoice.file.byte_size / 1024).toFixed(0)} KB`
                      : ""}
                  </span>
                  {canManage && isCreator && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={onFileDetach}
                      disabled={filePending}
                      className="size-7 text-muted-foreground hover:text-destructive"
                      aria-label="Remove attachment"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </div>
              ) : !invoice && pendingFile ? (
                <div className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-xs">
                  <Paperclip className="size-3.5 text-emerald-700" />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {pendingFile.name}
                  </span>
                  <span className="text-muted-foreground">
                    {(pendingFile.size / 1024).toFixed(0)} KB · attaches on save
                  </span>
                  {canManage && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setPendingFile(null)}
                      className="size-7 text-muted-foreground hover:text-destructive"
                      aria-label="Remove staged file"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </div>
              ) : (
                <label
                  htmlFor="invoice-file-pick"
                  className="flex flex-col items-center gap-2 rounded-md border-2 border-dashed border-border/60 px-4 py-6 text-center cursor-pointer hover:bg-muted/20"
                >
                  <Paperclip className="size-5 text-muted-foreground" />
                  <p className="text-xs font-medium">
                    {invoice
                      ? "Attach vendor PDF"
                      : "Attach vendor PDF (optional)"}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    PDF, image, Word or Excel — up to 20 MB
                  </p>
                  <Input
                    id="invoice-file-pick"
                    type="file"
                    accept="application/pdf,image/jpeg,image/png,image/webp,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain"
                    onChange={
                      invoice
                        ? onFilePick
                        : (e) => {
                            const f = e.target.files?.[0] ?? null;
                            e.target.value = "";
                            if (!f) return;
                            if (f.size > 20 * 1024 * 1024) {
                              toast.error("File must be 20 MB or smaller.");
                              return;
                            }
                            setPendingFile(f);
                          }
                    }
                    disabled={filePending || !canManage}
                    className="hidden"
                  />
                </label>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="notes" className="text-xs font-medium">
                Notes
              </Label>
              <div className="relative">
                <Textarea
                  id="notes"
                  value={state.notes}
                  onChange={(e) => setField("notes", e.target.value)}
                  onFocus={() => focusField("notes")}
                  onBlur={() => blurField("notes")}
                  rows={3}
                  placeholder="Optional — discrepancy notes, payment reference, etc."
                />
                <FieldEditingIndicator peer={fieldEditors.notes} />
              </div>
              <FieldError messages={fieldErrors.notes} />
            </div>

            {actionError && (
              <ErrorBanner
                detail={actionError.detail}
                code={actionError.code}
                debug={actionError.debug}
              />
            )}

            {canManage && !isCreator && creator && (
              <div className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
                <Lock className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  Only{" "}
                  <span className="font-medium text-foreground">
                    {creator.name}
                  </span>{" "}
                  can {invoice ? "save or delete" : "create"} from this
                  room. Your edits sync to them live.
                </span>
              </div>
            )}
          </div>

          {canManage && (
            <div className="flex flex-col gap-2 border-t border-border/60 bg-background px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              {invoice ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onDelete}
                  disabled={pending || !isCreator}
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  title={
                    isCreator
                      ? undefined
                      : creator
                        ? `Only ${creator.name} can delete from this room.`
                        : undefined
                  }
                >
                  <Trash2 className="mr-1.5 size-4" />
                  Delete invoice
                </Button>
              ) : (
                <span />
              )}
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
                        ? `Only ${creator.name} can ${invoice ? "save" : "create"} from this room.`
                        : undefined
                  }
                >
                  {pending && (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  )}
                  {invoice ? "Save changes" : "Add invoice"}
                </Button>
              </div>
            </div>
          )}
        </form>
      </fieldset>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {children}
      </span>
      <span className="h-px flex-1 bg-border/60" />
    </div>
  );
}

// ---------------------------------------------------------------- helpers

function JoinErrorCard({
  error,
}: {
  error: import("@/lib/realtime/use-live-form").JoinError;
}) {
  const config = {
    form_full: {
      icon: AlertCircle,
      tone: "amber" as const,
      title: "Form is at capacity",
      detail: error.limit
        ? `Up to ${error.limit} people can edit this invoice at once.`
        : "Wait for someone to leave, then refresh.",
    },
    forbidden: {
      icon: LockKeyhole,
      tone: "muted" as const,
      title: "You can't edit here",
      detail:
        "Ask an admin for the `procurement.invoice_manage` permission to join.",
    },
    bad_topic: {
      icon: AlertCircle,
      tone: "destructive" as const,
      title: "Unknown form",
      detail: "We couldn't find this invoice form. The link may be malformed.",
    },
    unknown: {
      icon: AlertCircle,
      tone: "destructive" as const,
      title: "Couldn't open the form",
      detail: "Something went wrong on our end. Please try again.",
    },
  }[error.reason];

  const Icon = config.icon;
  const toneClass =
    config.tone === "amber"
      ? "border-amber-500/30 bg-amber-50/40 dark:bg-amber-950/20"
      : config.tone === "destructive"
        ? "border-destructive/30 bg-destructive/[0.03]"
        : "border-border/60 bg-muted/30";
  const iconClass =
    config.tone === "amber"
      ? "text-amber-600 dark:text-amber-400"
      : config.tone === "destructive"
        ? "text-destructive"
        : "text-muted-foreground";

  return (
    <Card className={cn("border", toneClass)}>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-background">
          <Icon className={cn("size-6", iconClass)} />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-semibold">{config.title}</p>
          <p className="text-xs text-muted-foreground">{config.detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}

interface CollabFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  onFocus: (field: string) => void;
  onBlur: (field: string) => void;
  editor: import("@/lib/realtime/use-live-form").CollabPeer | null;
  errors?: string[];
  required?: boolean;
  placeholder?: string;
  hint?: string;
  mono?: boolean;
  type?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
}

function CollabField({
  id,
  label,
  value,
  onChange,
  onFocus,
  onBlur,
  editor,
  errors,
  required,
  placeholder,
  hint,
  mono,
  type = "text",
  inputMode,
}: CollabFieldProps) {
  const hasError = Boolean(errors && errors.length > 0);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs font-medium">
        {label}
        {required && (
          <span
            className="ml-1 text-muted-foreground/60"
            aria-hidden
            title="Required"
          >
            •
          </span>
        )}
      </Label>
      <div className="relative">
        <Input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => onFocus(id)}
          onBlur={() => onBlur(id)}
          required={required}
          placeholder={placeholder}
          inputMode={inputMode}
          aria-invalid={hasError}
          className={cn(
            "h-10",
            mono && "font-mono",
            hasError &&
              "border-destructive focus-visible:ring-destructive/20",
          )}
        />
        <FieldEditingIndicator peer={editor} />
      </div>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      <FieldError messages={errors} />
    </div>
  );
}
