"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge-mini";
import { ErrorBanner } from "@/components/forms/error-banner";
import { invalidateAudit } from "@/lib/audit/invalidator";
import {
  attachCertificateAction,
  detachCertificateAction,
} from "@/lib/certificates/actions";
import type { ErrorResult } from "@/lib/errors/server";
import type { Certificate, Item, ItemCertificate } from "@/lib/types";

interface Props {
  item: Item;
  canEdit: boolean;
  /** All active company certificate definitions (the picker list). */
  certificates: Certificate[];
}

interface NewAttachmentDraft {
  certificate_id: string;
  certificate_number: string;
  valid_from: string;
  valid_until: string;
  document_url: string;
  notes: string;
}

const EMPTY_DRAFT: NewAttachmentDraft = {
  certificate_id: "",
  certificate_number: "",
  valid_from: "",
  valid_until: "",
  document_url: "",
  notes: "",
};

export function ItemCertificatesSection({
  item,
  canEdit,
  certificates,
}: Props) {
  const attachments = item.certificate_attachments ?? [];
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<NewAttachmentDraft>(EMPTY_DRAFT);
  const [pending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<ErrorResult | null>(null);

  function onCertChange(certIdStr: string) {
    const cert = certificates.find((c) => String(c.id) === certIdStr);
    setDraft((d) => {
      // If the cert has a default validity and the user hasn't already
      // typed an expiry, pre-fill it from today + N months.
      let expiry = d.valid_until;
      if (cert?.default_validity_months && !expiry) {
        const date = new Date();
        date.setMonth(date.getMonth() + cert.default_validity_months);
        expiry = date.toISOString().slice(0, 10);
      }
      return { ...d, certificate_id: certIdStr, valid_until: expiry };
    });
  }

  function onAttach() {
    setActionError(null);
    if (!draft.certificate_id) {
      setActionError({
        ok: false,
        code: "validation_failed",
        detail: "Pick a certificate type first.",
        debug: {
          source: "ItemCertificatesSection",
          request_id: `fe-${Date.now()}`,
        },
      });
      return;
    }
    startTransition(async () => {
      const payload = {
        certificate_id: Number(draft.certificate_id),
        certificate_number: draft.certificate_number.trim() || null,
        valid_from: draft.valid_from || null,
        valid_until: draft.valid_until || null,
        document_url: draft.document_url.trim() || null,
        notes: draft.notes.trim() || null,
      };
      const res = await attachCertificateAction(item.uuid, payload);
      if (!res.ok) {
        setActionError(res);
        return;
      }
      toast.success("Certificate attached");
      setDraft(EMPTY_DRAFT);
      setAdding(false);
      invalidateAudit("item", item.id);
    });
  }

  function onDetach(att: ItemCertificate) {
    if (
      !window.confirm(
        `Remove the attachment for "${att.certificate?.name ?? "this certificate"}"?`,
      )
    ) {
      return;
    }
    setActionError(null);
    startTransition(async () => {
      const res = await detachCertificateAction(item.uuid, att.uuid);
      if (!res.ok) {
        setActionError(res);
        return;
      }
      toast.success("Certificate removed");
      invalidateAudit("item", item.id);
    });
  }

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <CardTitle className="text-base">Certificates</CardTitle>
            <CardDescription>
              Attach certificates this item holds. The expiry indexes the
              &quot;expiring in 30 days&quot; queue.
            </CardDescription>
          </div>
          {canEdit && !adding && certificates.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setAdding(true)}
            >
              <Plus className="mr-1.5 size-3.5" />
              Attach
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {certificates.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No certificates defined yet. Add definitions at{" "}
            <a
              href="/settings/certificates"
              className="text-foreground underline-offset-4 hover:underline"
            >
              /settings/certificates
            </a>{" "}
            first.
          </p>
        )}

        {attachments.length === 0 && certificates.length > 0 && (
          <p className="rounded-md border border-dashed border-border/60 py-6 text-center text-xs text-muted-foreground">
            No certificates attached.
          </p>
        )}

        {attachments.length > 0 && (
          <ul className="space-y-2">
            {attachments.map((att) => (
              <AttachmentRow
                key={att.uuid}
                attachment={att}
                canEdit={canEdit}
                onDelete={() => onDetach(att)}
                pending={pending}
              />
            ))}
          </ul>
        )}

        {adding && canEdit && (
          <div className="space-y-3 rounded-md border border-border/40 bg-muted/20 p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-sm">Certificate</Label>
                <Select
                  value={draft.certificate_id}
                  onValueChange={onCertChange}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Pick a certificate" />
                  </SelectTrigger>
                  <SelectContent>
                    {certificates.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Certificate number</Label>
                <Input
                  value={draft.certificate_number}
                  onChange={(e) =>
                    setDraft({ ...draft, certificate_number: e.target.value })
                  }
                  placeholder="Cert serial / reference"
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Valid from</Label>
                <Input
                  type="date"
                  value={draft.valid_from}
                  onChange={(e) =>
                    setDraft({ ...draft, valid_from: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Valid until</Label>
                <Input
                  type="date"
                  value={draft.valid_until}
                  onChange={(e) =>
                    setDraft({ ...draft, valid_until: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-sm">Document URL</Label>
                <Input
                  type="url"
                  value={draft.document_url}
                  onChange={(e) =>
                    setDraft({ ...draft, document_url: e.target.value })
                  }
                  placeholder="https://…"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-sm">Notes</Label>
                <Textarea
                  value={draft.notes}
                  onChange={(e) =>
                    setDraft({ ...draft, notes: e.target.value })
                  }
                  rows={2}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setAdding(false);
                  setDraft(EMPTY_DRAFT);
                  setActionError(null);
                }}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="button" onClick={onAttach} disabled={pending}>
                {pending && (
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                )}
                Attach
              </Button>
            </div>
          </div>
        )}

        {actionError && (
          <ErrorBanner
            detail={actionError.detail}
            code={actionError.code}
            debug={actionError.debug}
          />
        )}
      </CardContent>
    </Card>
  );
}

function AttachmentRow({
  attachment,
  canEdit,
  onDelete,
  pending,
}: {
  attachment: ItemCertificate;
  canEdit: boolean;
  onDelete: () => void;
  pending: boolean;
}) {
  const expiryTone = computeExpiryTone(attachment.valid_until);
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border/40 bg-background px-3 py-2.5">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">
            {attachment.certificate?.name ?? "(unlinked)"}
          </span>
          {attachment.certificate?.issuing_body && (
            <span className="text-xs text-muted-foreground">
              · {attachment.certificate.issuing_body}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {attachment.certificate_number && (
            <span className="font-mono">{attachment.certificate_number}</span>
          )}
          {attachment.valid_until && (
            <Badge tone={expiryTone}>
              Expires {attachment.valid_until}
            </Badge>
          )}
          {attachment.document_url && (
            <a
              href={attachment.document_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline"
            >
              <ExternalLink className="size-3" />
              Document
            </a>
          )}
        </div>
        {attachment.notes && (
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {attachment.notes}
          </p>
        )}
      </div>
      {canEdit && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onDelete}
          disabled={pending}
          className="text-destructive hover:text-destructive"
        >
          <Trash2 className="size-3.5" />
        </Button>
      )}
    </li>
  );
}

function computeExpiryTone(
  validUntil: string | null,
): "emerald" | "amber" | "destructive" | "muted" {
  if (!validUntil) return "muted";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(validUntil);
  exp.setHours(0, 0, 0, 0);
  const ms = exp.getTime() - today.getTime();
  const days = Math.round(ms / (1000 * 60 * 60 * 24));
  if (days < 0) return "destructive";
  if (days <= 30) return "amber";
  return "emerald";
}
