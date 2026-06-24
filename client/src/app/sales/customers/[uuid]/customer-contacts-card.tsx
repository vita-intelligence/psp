"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Loader2,
  Mail,
  Phone,
  PhoneCall,
  Smartphone,
  Star,
  Trash2,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ErrorBanner } from "@/components/forms/error-banner";
import type {
  Customer,
  CustomerContact,
  CustomerContactKind,
} from "@/lib/types";
import type { ErrorDebug } from "@/lib/errors/types";
import {
  addCustomerContactAction,
  removeCustomerContactAction,
} from "@/lib/customers/actions";

interface Props {
  customer: Customer;
  canEdit: boolean;
}

const KIND_LABEL: Record<CustomerContactKind, string> = {
  phone: "Phone",
  mobile: "Mobile",
  email: "Email",
  fax: "Fax",
  other: "Other",
};

const KIND_ICON: Record<CustomerContactKind, typeof Phone> = {
  phone: Phone,
  mobile: Smartphone,
  email: Mail,
  fax: PhoneCall,
  other: Phone,
};

export function CustomerContactsCard({ customer, canEdit }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<{
    detail: string;
    code?: string;
    debug?: ErrorDebug;
  } | null>(null);

  const [kind, setKind] = useState<CustomerContactKind>("phone");
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);

  function reset() {
    setKind("phone");
    setValue("");
    setLabel("");
    setIsPrimary(false);
    setError(null);
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await addCustomerContactAction(customer.uuid, {
        kind,
        value: value.trim(),
        label: label.trim() || null,
        is_primary: isPrimary,
      });
      if (res.ok) {
        toast.success("Contact added");
        setOpen(false);
        reset();
        router.refresh();
      } else {
        setError({ detail: res.detail, code: res.code, debug: res.debug });
      }
    });
  }

  function remove(contact: CustomerContact) {
    if (!confirm(`Remove ${KIND_LABEL[contact.kind]} "${contact.value}"?`)) return;
    startTransition(async () => {
      const res = await removeCustomerContactAction(customer.uuid, contact.uuid);
      if (res.ok) {
        toast.success("Contact removed");
        router.refresh();
      } else {
        toast.error(res.detail);
      }
    });
  }

  const contacts = customer.contacts ?? [];

  return (
    <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      <header className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Phone className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold tracking-tight">
            Contact information
          </h2>
          <span className="text-[11px] text-muted-foreground">
            {contacts.length}
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
            Add
          </Button>
        )}
      </header>

      {contacts.length === 0 ? (
        <p className="rounded-md border border-dashed border-border/60 px-4 py-6 text-center text-xs text-muted-foreground">
          No phones or emails yet. Add the Sales line, Accounts line, or
          a primary email.
        </p>
      ) : (
        <ul className="divide-y divide-border/60 rounded-md border border-border/60">
          {contacts.map((c) => {
            const Icon = KIND_ICON[c.kind];
            return (
              <li
                key={c.uuid}
                className="grid grid-cols-[24px_70px_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2"
              >
                <Icon className="size-4 text-muted-foreground" />
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  {KIND_LABEL[c.kind]}
                </span>
                <span className="truncate text-sm font-medium">{c.value}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {c.label ?? ""}
                </span>
                <div className="flex items-center gap-1">
                  {c.is_primary && (
                    <Star
                      className="size-3.5 fill-amber-500 text-amber-500"
                      aria-label="Primary"
                    />
                  )}
                  {canEdit && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground hover:text-destructive"
                      onClick={() => remove(c)}
                      aria-label="Remove"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add contact information</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Kind
                </Label>
                <Select
                  value={kind}
                  onValueChange={(v) => setKind(v as CustomerContactKind)}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(KIND_LABEL) as CustomerContactKind[]).map(
                      (k) => (
                        <SelectItem key={k} value={k}>
                          {KIND_LABEL[k]}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Label
                </Label>
                <Input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. Accounts, Sales"
                  className="h-9"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Value
              </Label>
              <Input
                type={kind === "email" ? "email" : "text"}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={
                  kind === "email"
                    ? "name@example.com"
                    : kind === "phone" || kind === "mobile" || kind === "fax"
                      ? "+44…"
                      : "value"
                }
                className="h-9"
              />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2">
              <Label className="text-xs font-medium">
                Primary
                <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                  (only one per customer)
                </span>
              </Label>
              <Switch checked={isPrimary} onCheckedChange={setIsPrimary} />
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
            <Button type="button" onClick={submit} disabled={pending || !value.trim()}>
              {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
