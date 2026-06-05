"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorBanner } from "@/components/forms/error-banner";
import { FieldError } from "@/components/forms/field-error";
import {
  createCertificateAction,
  deleteCertificateAction,
  updateCertificateAction,
} from "@/lib/certificates/actions";
import type { ErrorResult } from "@/lib/errors/server";
import type { Certificate, CertificateType } from "@/lib/types";

interface FormProps {
  certificate: Certificate | null;
  canEdit: boolean;
}

const CERT_TYPES: Array<{ value: CertificateType; label: string }> = [
  { value: "organic", label: "Organic" },
  { value: "halal", label: "Halal" },
  { value: "kosher", label: "Kosher" },
  { value: "iso_22000", label: "ISO 22000" },
  { value: "brc", label: "BRC" },
  { value: "fssc_22000", label: "FSSC 22000" },
  { value: "gmp", label: "GMP" },
  { value: "ifs", label: "IFS" },
  { value: "haccp", label: "HACCP" },
  { value: "usda_organic", label: "USDA Organic" },
  { value: "non_gmo_project", label: "Non-GMO Project" },
  { value: "other", label: "Other" },
];

export function CertificateForm({ certificate, canEdit }: FormProps) {
  const router = useRouter();
  const isEdit = certificate !== null;
  const [name, setName] = useState(certificate?.name ?? "");
  const [type, setType] = useState<CertificateType>(
    certificate?.certificate_type ?? "organic",
  );
  const [issuingBody, setIssuingBody] = useState(
    certificate?.issuing_body ?? "",
  );
  const [defaultValidity, setDefaultValidity] = useState(
    certificate?.default_validity_months?.toString() ?? "",
  );
  const [description, setDescription] = useState(
    certificate?.description ?? "",
  );
  const [isActive, setIsActive] = useState(certificate?.is_active ?? true);
  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setActionError(null);
    setFieldErrors({});

    startTransition(async () => {
      const payload = {
        name: name.trim(),
        certificate_type: type,
        issuing_body: issuingBody.trim() || null,
        default_validity_months: defaultValidity.trim()
          ? Number(defaultValidity)
          : null,
        description: description.trim() || null,
        is_active: isActive,
      };

      const res = isEdit
        ? await updateCertificateAction(certificate!.uuid, payload)
        : await createCertificateAction(payload);

      if (!res.ok) {
        setFieldErrors(res.fields ?? {});
        setActionError(res);
        return;
      }

      toast.success(isEdit ? "Certificate updated" : "Certificate created");
      router.push("/settings/certificates");
      router.refresh();
    });
  }

  function onDelete() {
    if (!certificate) return;
    if (
      !window.confirm(
        `Delete "${certificate.name}"? Items currently attaching this cert will hold orphaned references until cleaned up.`,
      )
    ) {
      return;
    }
    setActionError(null);
    startTransition(async () => {
      const res = await deleteCertificateAction(certificate.uuid);
      if (!res.ok) {
        setActionError(res);
        return;
      }
      toast.success("Certificate removed");
      router.push("/settings/certificates");
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-5 rounded-lg border border-border/60 bg-background p-5"
    >
      {isEdit && certificate?.code && (
        <div className="flex items-center gap-2 rounded-md border border-border/40 bg-muted/30 px-3 py-2 text-xs">
          <span className="font-medium text-muted-foreground">Code</span>
          <span className="font-mono">{certificate.code}</span>
        </div>
      )}

      <fieldset disabled={!canEdit || pending} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="c-name" className="text-sm">
              Name
            </Label>
            <Input
              id="c-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Organic — Soil Association"
              maxLength={120}
              required
            />
            <FieldError messages={fieldErrors.name} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as CertificateType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CERT_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError messages={fieldErrors.certificate_type} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-body" className="text-sm">
              Issuing body
            </Label>
            <Input
              id="c-body"
              value={issuingBody}
              onChange={(e) => setIssuingBody(e.target.value)}
              placeholder="Soil Association, HFA, ISO, …"
              maxLength={120}
            />
            <FieldError messages={fieldErrors.issuing_body} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-validity" className="text-sm">
              Default validity (months)
            </Label>
            <Input
              id="c-validity"
              type="number"
              inputMode="numeric"
              value={defaultValidity}
              onChange={(e) => setDefaultValidity(e.target.value)}
              placeholder="12, 24…"
            />
            <p className="text-xs text-muted-foreground">
              Pre-fills the expiry on new attachments.
            </p>
            <FieldError messages={fieldErrors.default_validity_months} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="c-desc" className="text-sm">
            Description
          </Label>
          <Textarea
            id="c-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
          <FieldError messages={fieldErrors.description} />
        </div>

        <label className="flex items-start gap-2 rounded-md border border-border/40 bg-muted/20 px-3 py-2 text-sm">
          <Checkbox
            checked={isActive}
            onCheckedChange={(c) => setIsActive(Boolean(c))}
          />
          <span className="flex-1">
            <span className="font-medium">Active</span>
            <span className="block text-xs text-muted-foreground">
              Inactive certificates stay in history but disappear from the
              picker on items.
            </span>
          </span>
        </label>
      </fieldset>

      {actionError && (
        <ErrorBanner
          detail={actionError.detail}
          code={actionError.code}
          debug={actionError.debug}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        {isEdit && canEdit ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onDelete}
            disabled={pending}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="mr-1.5 size-3.5" />
            Delete certificate
          </Button>
        ) : (
          <span />
        )}

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.push("/settings/certificates")}
          >
            Cancel
          </Button>
          {canEdit && (
            <Button type="submit" disabled={pending || !name.trim()}>
              {pending ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : (
                <Save className="mr-1.5 size-4" />
              )}
              {isEdit ? "Save changes" : "Create certificate"}
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
