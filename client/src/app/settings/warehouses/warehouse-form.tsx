"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FieldError } from "@/components/forms/field-error";
import { ErrorBanner } from "@/components/forms/error-banner";
import type { ErrorResult } from "@/lib/errors/server";
import { CollabAvatars } from "@/components/realtime/collab-avatars";
import { FieldEditingIndicator } from "@/components/realtime/field-editing-indicator";
import { RemoteCursor } from "@/components/realtime/remote-cursor";
import { cn } from "@/lib/utils";
import { useLiveForm } from "@/lib/realtime/use-live-form";
import { useFormPresenceBeacon } from "@/lib/realtime/use-form-presence-beacon";
import type {
  Warehouse,
  WarehouseKind,
  Contact,
  CompanyDefaults,
} from "@/lib/types";
import type { WorkingHours, Holiday } from "@/lib/company/bags";
import {
  WorkingHoursEditor,
  summarizeWorkingHours,
} from "@/components/scheduling/working-hours-editor";
import {
  HolidaysEditor,
  holidaysFromBag,
  holidaysToBag,
  summarizeHolidays,
} from "@/components/scheduling/holidays-editor";
import type { FieldErrors } from "@/lib/auth/actions";
import {
  createProductionFacilityAction,
  createWarehouseAction,
  updateProductionFacilityAction,
  updateWarehouseAction,
} from "@/lib/warehouses/actions";
import { invalidateAudit, subscribeRestore } from "@/lib/audit/invalidator";
import {
  AlertCircle,
  Loader2,
  Lock,
  LockKeyhole,
  Plus,
  Trash2,
} from "lucide-react";

interface WarehouseFormProps {
  /** `null` ⇒ create mode; otherwise edit. */
  warehouse: Warehouse | null;
  /** Org-wide context used by the form for inheritance display (the
   *  company name + the timezone the warehouse inherits when its
   *  override is off). Comes from the unauthed `/company/defaults`
   *  endpoint so users without `company.view` can still open this
   *  page. */
  company: CompanyDefaults;
  canEdit: boolean;
  /** Which surface this form is mounted on. Defaults to `warehouse`
   *  for backwards compatibility with existing call sites. Controls
   *  the action endpoints, the channel topic, the navigation target
   *  on create, and the copy in the header. */
  kind?: WarehouseKind;
  /** Fired on successful save so the EditModeToggle wrapper flips
   *  the page back to view mode. */
  onSavedSuccess?: () => void;
}

const CONTACT_TYPES: Contact["type"][] = ["phone", "email", "url", "other"];

interface FormState {
  name: string;
  address: string;
  notes: string;
  is_active: boolean;
  timezone: string;
  /** True when this warehouse's timezone overrides the company one. */
  timezone_override: boolean;
  /** Per-day open/close map, only meaningful when `working_hours_override`
   *  is true. When false, the warehouse inherits the company bag. */
  working_hours_override: boolean;
  working_hours: WorkingHours;
  /** Flat holiday list — converted to/from the JSONB `{items: [...]}`
   *  shape at serialize boundaries. */
  holidays_override: boolean;
  holidays: Holiday[];
  contacts: Contact[];
}

function initialFrom(warehouse: Warehouse | null): FormState {
  if (!warehouse) {
    return {
      name: "",
      address: "",
      notes: "",
      is_active: true,
      timezone: "",
      timezone_override: false,
      working_hours_override: false,
      working_hours: {},
      holidays_override: false,
      holidays: [],
      contacts: [],
    };
  }
  return {
    name: warehouse.name,
    address: warehouse.address ?? "",
    notes: warehouse.notes ?? "",
    is_active: warehouse.is_active,
    timezone: warehouse.timezone ?? "",
    timezone_override: warehouse.timezone !== null,
    working_hours_override: warehouse.working_hours !== null,
    working_hours: (warehouse.working_hours as WorkingHours) ?? {},
    holidays_override: warehouse.holidays !== null,
    holidays: holidaysFromBag(
      warehouse.holidays as { items?: unknown } | null,
    ),
    contacts: warehouse.contacts?.items ?? [],
  };
}

// Same short list as the company locale picker — picking a "fancy"
// search-driven select can come later.
const TIMEZONES = [
  "Europe/London",
  "Europe/Dublin",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Warsaw",
  "Europe/Kyiv",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Tokyo",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Australia/Sydney",
  "UTC",
];

export function WarehouseForm({
  warehouse,
  company,
  canEdit,
  kind = "warehouse",
  onSavedSuccess,
}: WarehouseFormProps) {
  const router = useRouter();
  // Distinct channel topic per kind so a warehouse editor and a
  // facility editor never collide on the same browser session.
  const resourceKey = kind === "production_facility" ? "production-facility" : "warehouse";
  const resource = warehouse
    ? `${resourceKey}:${warehouse.uuid}`
    : `${resourceKey}:new`;
  const listPath =
    kind === "production_facility"
      ? "/settings/production-sites"
      : "/settings/warehouses";
  const noun = kind === "production_facility" ? "production site" : "warehouse";
  // Broadcast our current form on the lobby so the list page can show
  // "X is editing this" badges. Cleared on unmount when we navigate
  // away from the form.
  useFormPresenceBeacon(resource);

  // Commit payload shape — what the creator pushes to peers on success.
  // Discriminated union so receivers branch cleanly.
  type CommitPayload =
    | { kind: "created"; uuid: string; name: string }
    | { kind: "saved"; state: FormState };

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
    resource,
    // Viewer (no `warehouses.edit`/`.create`) ⇒ skip the channel:
    // the backend would 403 the join anyway, and a viewer has nothing
    // to broadcast. The form below renders read-only from the
    // server-component fetch — no JoinError card, no presence chips.
    disabled: !canEdit,
    initialState: useMemo(() => initialFrom(warehouse), [warehouse]),
    onCommit: (raw) => {
      // Only the room creator triggers commits — peers react. The
      // local sender already does its own follow-up (router.push /
      // setOriginal), so we don't re-fire any of that for them.
      const msg = raw as CommitPayload | null;
      if (!msg) return;
      if (msg.kind === "created") {
        toast.success(`${capitalise(noun)} created`, {
          description: `${creator?.name ?? "The host"} just finalized "${msg.name}".`,
        });
        router.push(`${listPath}/${msg.uuid}`);
      } else if (msg.kind === "saved") {
        toast.success("Saved", {
          description: `${creator?.name ?? "The host"} just saved the form.`,
        });
        // Adopt the committed state as the new baseline so our
        // "dirty" indicator resets to clean — matching what the
        // creator sees on their side.
        setOriginal(msg.state);
        resetState(msg.state);
        // Refresh the peer's Activity card too — the host just wrote
        // an audit row that our local view doesn't have yet.
        if (warehouse) invalidateAudit("warehouse", warehouse.id);
      }
    },
  });

  // Anchor for the live-cursor coordinate space. Senders normalize
  // mouse position against this element's bounding rect; receivers
  // multiply back out. Same anchor, same visual position regardless
  // of screen size.
  const cursorAnchorRef = useRef<HTMLDivElement | null>(null);
  const [anchorSize, setAnchorSize] = useState<{ w: number; h: number }>({
    w: 0,
    h: 0,
  });

  // Keep the anchor size in sync with layout changes so remote cursors
  // re-render at the right pixel positions when the form reflows
  // (resize, content changes, font load, etc.).
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

  // Hide our cursor on unmount so peers don't see a stale arrow sitting
  // where we last moved before navigating away.
  useEffect(() => {
    return () => hideCursor();
  }, [hideCursor]);

  // "Restore version" listener — clicking Restore on an Activity event
  // dispatches the row's `state_after`. Convert the raw column values
  // back into form state (handling override flags + JSONB bag shapes)
  // and replace local state. User then reviews + Saves to record it
  // as a new audit event.
  useEffect(() => {
    if (!warehouse) return;
    return subscribeRestore("warehouse", warehouse.id, (raw) => {
      const r = raw as Partial<Warehouse> & Record<string, unknown>;
      const restored: FormState = {
        name: typeof r.name === "string" ? r.name : "",
        address: typeof r.address === "string" ? r.address : "",
        notes: typeof r.notes === "string" ? r.notes : "",
        is_active: r.is_active !== false,
        timezone: typeof r.timezone === "string" ? r.timezone : "",
        timezone_override: r.timezone != null,
        working_hours_override: r.working_hours != null,
        working_hours: (r.working_hours as WorkingHours) ?? {},
        holidays_override: r.holidays != null,
        holidays: holidaysFromBag(
          r.holidays as { items?: unknown } | null,
        ),
        contacts:
          ((r.contacts as { items?: Contact[] } | null)?.items as Contact[]) ?? [],
      };
      resetState(restored);
    });
  }, [warehouse, resetState]);

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

  const [original, setOriginal] = useState<FormState>(() =>
    initialFrom(warehouse),
  );
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = JSON.stringify(state) !== JSON.stringify(original);

  // Contact-list helpers
  function addContact() {
    setField("contacts", [
      ...state.contacts,
      { type: "phone", label: "", value: "" },
    ] as FormState["contacts"]);
  }

  function updateContact(index: number, patch: Partial<Contact>) {
    setField(
      "contacts",
      state.contacts.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    );
  }

  function removeContact(index: number) {
    setField(
      "contacts",
      state.contacts.filter((_, i) => i !== index),
    );
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    setActionError(null);

    const payload: Partial<Warehouse> = {
      name: state.name.trim(),
      address: state.address || null,
      notes: state.notes || null,
      is_active: state.is_active,
      timezone: state.timezone_override ? state.timezone || null : null,
      // Inheritance contract for the JSONB columns: `null` means
      // "use company defaults"; an object means "we've overridden it,
      // honour what's in here even if empty".
      working_hours: state.working_hours_override
        ? (state.working_hours as Record<string, unknown>)
        : null,
      holidays: state.holidays_override
        ? (holidaysToBag(state.holidays) as Record<string, unknown>)
        : null,
      contacts: {
        items: state.contacts
          .filter((c) => c.value.trim().length > 0)
          .map((c) => ({
            type: c.type,
            label: c.label?.trim() || undefined,
            value: c.value.trim(),
          })),
      },
    };

    const update =
      kind === "production_facility"
        ? updateProductionFacilityAction
        : updateWarehouseAction;
    const create =
      kind === "production_facility"
        ? createProductionFacilityAction
        : createWarehouseAction;

    startTransition(async () => {
      const res = warehouse
        ? await update(warehouse.uuid, payload)
        : await create(payload);

      if (res.ok) {
        toast.success(
          warehouse
            ? `${capitalise(noun)} saved`
            : `${capitalise(noun)} created`,
        );
        setOriginal(state);

        // Refresh the Activity card on this page without a page
        // reload — the audit row was just written and the next
        // /api/audit fetch will pick it up.
        invalidateAudit("warehouse", res.warehouse.id);

        // Tell every other editor in the room: the form is finalized.
        // Peers receiving `created` navigate to the new resource;
        // peers receiving `saved` reset their local baseline and
        // show a toast.
        if (warehouse) {
          broadcastCommit({ kind: "saved", state });
          onSavedSuccess?.();
        } else {
          broadcastCommit({
            kind: "created",
            uuid: res.warehouse.uuid,
            name: res.warehouse.name,
          });
          router.push(`${listPath}/${res.warehouse.uuid}`);
        }
        return;
      }
      setFieldErrors(res.fields ?? {});
      setActionError(res);
    });
  }

  function onReset() {
    resetState(original);
    setFieldErrors({});
    setActionError(null);
  }

  // If we couldn't join the form channel (capacity / permission), short-
  // circuit to a clear empty-state instead of rendering a broken form.
  if (joinError) {
    return <JoinErrorCard error={joinError} />;
  }

  return (
    <Card
      ref={cursorAnchorRef}
      onMouseMove={onCursorMove}
      onMouseLeave={hideCursor}
      // The form Card's width is capped by `max-w-3xl` on the parent
      // page wrapper — that's what keeps the cursor-fraction → pixel
      // mapping consistent across collaborators on different viewport
      // sizes (also makes form + audit cards line up).
      className="relative border-border/60"
    >
      {/* Remote cursors layer — anchored to the Card so coordinates
          stay in sync with the form's actual bounding box, not the
          viewport. Wrapped in an overflow-hidden mask matching the
          Card's rounded corners so cursors near the edges can't
          visually escape onto sticky headers or adjacent UI; the
          Card itself stays `overflow: visible` so Select dropdowns
          and tooltips still pop out normally. `z-30` on the mask
          establishes a stacking context so cursors paint above the
          form inputs (otherwise z-index leaks through and the input
          borders cut through the name tags). */}
      <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden rounded-xl">
        {Object.entries(cursors).map(([id, cursor]) => (
          <RemoteCursor
            key={id}
            cursor={cursor}
            anchorWidth={anchorSize.w}
            anchorHeight={anchorSize.h}
          />
        ))}
      </div>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle>
              {warehouse ? warehouse.name : `New ${noun}`}
            </CardTitle>
            <CardDescription>
              Set up a physical location. Working hours, timezone, and
              holidays inherit from{" "}
              <span className="font-medium text-foreground">{company.name}</span>{" "}
              unless overridden here.
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
          <form onSubmit={onSubmit} noValidate className="space-y-6">
            {/* General */}
            <div className="space-y-4">
              <SectionTitle>General</SectionTitle>

              <CollabRow
                id="name"
                label="Name"
                required
                value={state.name}
                onChange={(v) => setField("name", v)}
                onFocus={focusField}
                onBlur={blurField}
                editor={fieldEditors.name}
                errors={fieldErrors.name}
              />
              <CollabTextareaRow
                id="address"
                label="Address"
                value={state.address}
                onChange={(v) => setField("address", v)}
                onFocus={focusField}
                onBlur={blurField}
                editor={fieldEditors.address}
                errors={fieldErrors.address}
              />
              <CollabTextareaRow
                id="notes"
                label="Notes"
                value={state.notes}
                onChange={(v) => setField("notes", v)}
                onFocus={focusField}
                onBlur={blurField}
                editor={fieldEditors.notes}
                errors={fieldErrors.notes}
              />

              <div className="grid gap-2 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4">
                <Label className="pt-1.5 text-sm font-medium">Active</Label>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={state.is_active}
                    onCheckedChange={(v) => setField("is_active", v)}
                    aria-label={`${capitalise(noun)} is active`}
                  />
                  <span className="text-sm text-muted-foreground">
                    {state.is_active
                      ? "Active — visible everywhere on the platform"
                      : "Inactive — hidden from selectors and stock moves"}
                  </span>
                </div>
              </div>
            </div>

            {/* Inheritance: timezone */}
            <div className="space-y-4 rounded-md border border-border/60 bg-muted/30 p-4">
              <SectionTitle>Timezone</SectionTitle>
              <div className="flex items-start gap-3">
                <Switch
                  checked={state.timezone_override}
                  onCheckedChange={(v) => {
                    setField("timezone_override", v);
                    if (!v) setField("timezone", "");
                    else if (!state.timezone)
                      setField("timezone", company.timezone);
                  }}
                  aria-label="Override company timezone"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {state.timezone_override
                      ? `Using a ${noun}-specific timezone`
                      : "Inheriting from company"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Currently:{" "}
                    <span className="font-medium text-foreground">
                      {state.timezone_override
                        ? state.timezone || "(none)"
                        : company.timezone}
                    </span>
                  </p>
                </div>
              </div>
              {state.timezone_override && (
                <div className="relative">
                  <Select
                    value={state.timezone}
                    onValueChange={(v) => setField("timezone", v)}
                  >
                    <SelectTrigger
                      onFocus={() => focusField("timezone")}
                      onBlur={() => blurField("timezone")}
                      className="h-10 w-full"
                    >
                      <SelectValue placeholder="Select a timezone" />
                    </SelectTrigger>
                    <SelectContent>
                      {TIMEZONES.map((tz) => (
                        <SelectItem key={tz} value={tz}>
                          {tz}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldEditingIndicator peer={fieldEditors.timezone} />
                </div>
              )}
            </div>

            {/* Inheritance: working hours */}
            <div className="space-y-4 rounded-md border border-border/60 bg-muted/30 p-4">
              <SectionTitle>Working hours</SectionTitle>
              <div className="flex items-start gap-3">
                <Switch
                  checked={state.working_hours_override}
                  onCheckedChange={(v) => {
                    setField("working_hours_override", v);
                    if (!v) setField("working_hours", {});
                    else if (
                      Object.keys(state.working_hours).length === 0 &&
                      company.working_hours
                    ) {
                      // Seed the override from the company defaults so
                      // the user sees a familiar starting point instead
                      // of an empty grid.
                      setField(
                        "working_hours",
                        company.working_hours as WorkingHours,
                      );
                    }
                  }}
                  aria-label="Override company working hours"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {state.working_hours_override
                      ? `${capitalise(noun)}-specific schedule`
                      : "Inheriting from company"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Currently:{" "}
                    <span className="font-medium text-foreground">
                      {state.working_hours_override
                        ? summarizeWorkingHours(state.working_hours)
                        : summarizeWorkingHours(
                            company.working_hours as WorkingHours,
                          )}
                    </span>
                  </p>
                </div>
              </div>
              {state.working_hours_override && (
                <WorkingHoursEditor
                  value={state.working_hours}
                  onChange={(next) => setField("working_hours", next)}
                  disabled={!canEdit || pending}
                  idPrefix={`wh-${warehouse?.uuid ?? "new"}`}
                />
              )}
            </div>

            {/* Inheritance: holidays */}
            <div className="space-y-4 rounded-md border border-border/60 bg-muted/30 p-4">
              <SectionTitle>Holidays</SectionTitle>
              <div className="flex items-start gap-3">
                <Switch
                  checked={state.holidays_override}
                  onCheckedChange={(v) => {
                    setField("holidays_override", v);
                    if (!v) setField("holidays", []);
                    else if (
                      state.holidays.length === 0 &&
                      company.holidays
                    ) {
                      setField(
                        "holidays",
                        holidaysFromBag(
                          company.holidays as { items?: unknown },
                        ),
                      );
                    }
                  }}
                  aria-label="Override company holidays"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {state.holidays_override
                      ? `${capitalise(noun)}-specific holiday calendar`
                      : "Inheriting from company"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Currently:{" "}
                    <span className="font-medium text-foreground">
                      {state.holidays_override
                        ? summarizeHolidays(state.holidays)
                        : summarizeHolidays(
                            holidaysFromBag(
                              company.holidays as { items?: unknown },
                            ),
                          )}
                    </span>
                  </p>
                </div>
              </div>
              {state.holidays_override && (
                <HolidaysEditor
                  value={state.holidays}
                  onChange={(next) => setField("holidays", next)}
                  disabled={!canEdit || pending}
                />
              )}
            </div>

            {/* Contacts */}
            <div className="space-y-4">
              <SectionTitle>Contacts</SectionTitle>
              {state.contacts.length === 0 ? (
                <p className="rounded-md border border-dashed border-border/60 px-4 py-6 text-center text-xs text-muted-foreground">
                  No contacts yet. Add the warehouse manager, security desk,
                  or whatever else is useful.
                </p>
              ) : (
                <ul className="divide-y divide-border/60 rounded-md border border-border/60">
                  <li className="grid grid-cols-[100px_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <span>Type</span>
                    <span>Label</span>
                    <span>Value</span>
                    <span className="sr-only">Actions</span>
                  </li>
                  {state.contacts.map((c, i) => (
                    <li
                      key={i}
                      className="grid grid-cols-[100px_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2"
                    >
                      <Select
                        value={c.type}
                        onValueChange={(v) =>
                          updateContact(i, { type: v as Contact["type"] })
                        }
                      >
                        <SelectTrigger className="h-10 capitalize">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CONTACT_TYPES.map((t) => (
                            <SelectItem
                              key={t}
                              value={t}
                              className="capitalize"
                            >
                              {t}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        type="text"
                        placeholder="e.g. Warehouse manager"
                        value={c.label ?? ""}
                        onChange={(e) =>
                          updateContact(i, { label: e.target.value })
                        }
                        className="h-10"
                      />
                      <Input
                        type="text"
                        placeholder={
                          c.type === "email"
                            ? "name@example.com"
                            : c.type === "phone"
                              ? "+44…"
                              : c.type === "url"
                                ? "https://…"
                                : "value"
                        }
                        value={c.value}
                        onChange={(e) =>
                          updateContact(i, { value: e.target.value })
                        }
                        className="h-10"
                      />
                      {canEdit && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeContact(i)}
                          className="size-9 text-muted-foreground hover:text-destructive"
                          aria-label="Remove contact"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {canEdit && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addContact}
                >
                  <Plus className="mr-1.5 size-4" />
                  Add contact
                </Button>
              )}
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
                {/* Creator gate — only the first user to join the room
                    can finalize the form. Prevents two collaborators
                    from both clicking Save and racing to write
                    conflicting state. Cleared automatically when the
                    creator leaves and the next earliest joiner is
                    promoted. */}
                {!isCreator && creator && (
                  <div className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
                    <Lock className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      Only{" "}
                      <span className="font-medium text-foreground">
                        {creator.name}
                      </span>{" "}
                      can {warehouse ? "save" : "create"} from this room.
                      Your edits sync to them live.
                    </span>
                  </div>
                )}
                <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-end">
                  {/* Discard is creator-only too — otherwise a non-
                      creator would reset their local view while the
                      rest of the room still sees the in-progress
                      edits, immediately desyncing them. */}
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
                          ? `Only ${creator.name} can ${warehouse ? "save" : "create"} from this room.`
                          : undefined
                    }
                  >
                    {pending && (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    )}
                    {warehouse ? "Save changes" : `Create ${noun}`}
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

function JoinErrorCard({
  error,
}: {
  error: import("@/lib/realtime/use-live-form").JoinError;
}) {
  // Map each reason to a hand-crafted message — generic "something
  // went wrong" copy makes capacity errors look like bugs.
  const config = {
    form_full: {
      icon: AlertCircle,
      tone: "amber",
      title: `Form is at capacity`,
      detail: error.limit
        ? `Up to ${error.limit} people can edit this form at once. Wait for someone to leave, then refresh.`
        : "Wait for someone to leave, then refresh.",
    },
    forbidden: {
      icon: LockKeyhole,
      tone: "muted",
      title: "You can't edit here",
      detail:
        "Ask an admin for the `warehouses.edit` permission to join this form.",
    },
    bad_topic: {
      icon: AlertCircle,
      tone: "destructive",
      title: "Unknown form",
      detail:
        "We couldn't find this form. The link may have been malformed.",
    },
    unknown: {
      icon: AlertCircle,
      tone: "destructive",
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

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h3>
  );
}

interface CollabRowProps {
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
}

function CollabRow({
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
}: CollabRowProps) {
  const hasError = Boolean(errors && errors.length > 0);
  return (
    <div className="grid gap-2 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4">
      <Label htmlFor={id} className="pt-2.5 text-sm font-medium">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      <div className="space-y-1.5">
        <div className="relative">
          <Input
            id={id}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => onFocus(id)}
            onBlur={() => onBlur(id)}
            required={required}
            placeholder={placeholder}
            aria-invalid={hasError}
            className={cn(
              "h-11",
              mono && "font-mono",
              hasError &&
                "border-destructive focus-visible:ring-destructive/20",
            )}
          />
          <FieldEditingIndicator peer={editor} />
        </div>
        {hint && (
          <p className="text-xs text-muted-foreground">{hint}</p>
        )}
        <FieldError messages={errors} />
      </div>
    </div>
  );
}

interface CollabTextareaRowProps {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  onFocus: (field: string) => void;
  onBlur: (field: string) => void;
  editor: import("@/lib/realtime/use-live-form").CollabPeer | null;
  errors?: string[];
}

function CollabTextareaRow({
  id,
  label,
  value,
  onChange,
  onFocus,
  onBlur,
  editor,
  errors,
}: CollabTextareaRowProps) {
  const hasError = Boolean(errors && errors.length > 0);
  return (
    <div className="grid gap-2 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4">
      <Label htmlFor={id} className="pt-2.5 text-sm font-medium">
        {label}
      </Label>
      <div className="space-y-1.5">
        <div className="relative">
          <Textarea
            id={id}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => onFocus(id)}
            onBlur={() => onBlur(id)}
            rows={3}
            aria-invalid={hasError}
            className={cn(
              hasError &&
                "border-destructive focus-visible:ring-destructive/20",
            )}
          />
          <FieldEditingIndicator peer={editor} />
        </div>
        <FieldError messages={errors} />
      </div>
    </div>
  );
}

function capitalise(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}
