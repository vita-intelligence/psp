"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CalendarClock,
  Loader2,
  Mail,
  MessageSquare,
  Phone,
  PhoneCall,
  StickyNote,
  Users as MeetingIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorBanner } from "@/components/forms/error-banner";
import { UserAvatar } from "@/components/users/user-avatar";
import type {
  Customer,
  CustomerContactEvent,
  CustomerContactEventKind,
} from "@/lib/types";
import type { ErrorDebug } from "@/lib/errors/types";
import { logCustomerContactEventAction } from "@/lib/customers/actions";
import { formatCompanyDate, type FormatPrefs } from "@/lib/format/company";

interface Props {
  customer: Customer;
  canEdit: boolean;
  prefs: FormatPrefs;
}

const KIND_LABEL: Record<CustomerContactEventKind, string> = {
  call: "Call",
  email: "Email",
  meeting: "Meeting",
  message: "Message",
  note: "Note",
  other: "Other",
};

const KIND_ICON: Record<CustomerContactEventKind, typeof PhoneCall> = {
  call: PhoneCall,
  email: Mail,
  meeting: MeetingIcon,
  message: MessageSquare,
  note: StickyNote,
  other: Phone,
};

/**
 * Contact-event log card. The "Log contact" action button posts an
 * event row to the server, which transactionally updates the
 * customer's last_contact_at + next_contact_at. That's how the
 * derived status projection ("lead" → "prospect" → "active") crosses
 * over without a background job.
 */
export function CustomerContactEventsCard({ customer, canEdit, prefs }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<{
    detail: string;
    code?: string;
    debug?: ErrorDebug;
  } | null>(null);

  const [kind, setKind] = useState<CustomerContactEventKind>("call");
  const [summary, setSummary] = useState("");
  const [occurredDate, setOccurredDate] = useState(
    new Date().toISOString().slice(0, 16),
  );

  function reset() {
    setKind("call");
    setSummary("");
    setOccurredDate(new Date().toISOString().slice(0, 16));
    setError(null);
  }

  function submit() {
    setError(null);
    const occurredAt = new Date(occurredDate).toISOString();
    startTransition(async () => {
      const res = await logCustomerContactEventAction(customer.uuid, {
        kind,
        occurred_at: occurredAt,
        summary: summary.trim() || null,
      });
      if (res.ok) {
        toast.success("Contact logged");
        setOpen(false);
        reset();
        router.refresh();
      } else {
        setError({ detail: res.detail, code: res.code, debug: res.debug });
      }
    });
  }

  const events = customer.contact_events ?? [];

  return (
    <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CalendarClock className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold tracking-tight">
            Contact log
          </h2>
          <span className="text-[11px] text-muted-foreground">
            {events.length}
          </span>
        </div>
        {canEdit && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              reset();
              setOpen(true);
            }}
          >
            <PhoneCall className="mr-1.5 size-4" />
            Log contact
          </Button>
        )}
      </header>

      {events.length === 0 ? (
        <p className="rounded-md border border-dashed border-border/60 px-4 py-6 text-center text-xs text-muted-foreground">
          No contact events yet. Click <strong>Log contact</strong> when
          you next speak with this customer — the cadence on the form
          will update automatically.
        </p>
      ) : (
        <ul className="space-y-3">
          {events.map((event) => (
            <ContactEventRow key={event.uuid} event={event} prefs={prefs} />
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Log a contact</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Kind
                </Label>
                <Select
                  value={kind}
                  onValueChange={(v) =>
                    setKind(v as CustomerContactEventKind)
                  }
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(
                      Object.keys(KIND_LABEL) as CustomerContactEventKind[]
                    ).map((k) => (
                      <SelectItem key={k} value={k}>
                        {KIND_LABEL[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  When
                </Label>
                <Input
                  type="datetime-local"
                  value={occurredDate}
                  onChange={(e) => setOccurredDate(e.target.value)}
                  className="h-9"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Summary
              </Label>
              <Textarea
                rows={4}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="What did you discuss? Next steps?"
              />
            </div>

            {error && (
              <ErrorBanner detail={error.detail} code={error.code} debug={error.debug} />
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="button" onClick={submit} disabled={pending}>
              {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Log contact
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function ContactEventRow({
  event,
  prefs,
}: {
  event: CustomerContactEvent;
  prefs: FormatPrefs;
}) {
  const Icon = KIND_ICON[event.kind];
  return (
    <li className="rounded-md border border-border/60 bg-card/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className="size-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">{KIND_LABEL[event.kind]}</span>
          <span className="text-[11px] text-muted-foreground">
            {formatCompanyDate(event.occurred_at, prefs)}
          </span>
        </div>
        {event.logged_by && (
          <div className="flex items-center gap-1.5">
            <UserAvatar
              name={event.logged_by.name}
              email={event.logged_by.email}
              avatar={event.logged_by.avatar ?? null}
              sizeClassName="size-5"
              fallbackClassName="text-[9px]"
            />
            <span className="text-[11px] text-muted-foreground">
              {event.logged_by.name}
            </span>
          </div>
        )}
      </div>
      {event.summary && (
        <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed">
          {event.summary}
        </p>
      )}
    </li>
  );
}
