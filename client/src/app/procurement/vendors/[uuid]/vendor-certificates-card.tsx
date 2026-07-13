"use client";

import Link from "next/link";
import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Award,
  CalendarRange,
  Download,
  Loader2,
  Paperclip,
  Plus,
  X,
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
import { Badge } from "@/components/ui/badge-mini";
import { ErrorBanner } from "@/components/forms/error-banner";
import {
  SearchPicker,
  type SearchPickerOption,
} from "@/components/forms/search-picker";
import type { Vendor, VendorFile } from "@/lib/types";
import type { ErrorDebug } from "@/lib/errors/types";
import {
  attachVendorCertificateAction,
  removeVendorCertificateAction,
} from "@/lib/vendors/actions";
import {
  FileUploadField,
  truncateMiddle,
} from "./vendor-qualification-card";
import {
  DerivedDateField,
  addMonths,
} from "@/components/forms/derived-date-field";

interface Props {
  vendor: Vendor;
  canEdit: boolean;
}

interface CertOption extends SearchPickerOption {
  /** Carried through so the "valid until" field can auto-derive from
   *  the certificate's default validity window. */
  defaultValidityMonths: number | null;
}

/**
 * Per-vendor certificate attachments. Pulls definitions from the
 * existing /api/certificates registry — admins maintain GMP / BRC /
 * FSSC / halal / kosher / organic there once, the same way we do
 * for items.
 */
export function VendorCertificatesCard({ vendor, canEdit }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<{
    detail: string;
    code?: string;
    debug?: ErrorDebug;
  } | null>(null);

  const [pickedCert, setPickedCert] = useState<CertOption | null>(null);
  const [certNumber, setCertNumber] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [docFile, setDocFile] = useState<VendorFile | null>(null);
  const [notes, setNotes] = useState("");

  const attachedCertIds = useMemo(
    () => new Set(vendor.certificates.map((r) => r.certificate_id)),
    [vendor.certificates],
  );

  // Server-side cert search. Drops the eager `certificates` prop so
  // the page stays light when the registry grows.
  const fetchCertificates = useCallback(
    async (query: string, signal?: AbortSignal): Promise<CertOption[]> => {
      const params = new URLSearchParams({ limit: "50" });
      if (query) params.set("search", query);
      const res = await fetch(`/api/certificates?${params.toString()}`, {
        signal,
      });
      if (!res.ok)
        throw new Error(`Certificates search failed (${res.status})`);
      const body = (await res.json()) as {
        items?: Array<{
          id: number;
          name: string;
          issuing_body?: string | null;
          default_validity_months?: number | null;
        }>;
      };
      return (body.items ?? []).map((c) => ({
        id: c.id,
        label: c.name,
        sublabel: c.issuing_body ?? null,
        defaultValidityMonths: c.default_validity_months ?? null,
      }));
    },
    [],
  );

  function resetForm() {
    setPickedCert(null);
    setCertNumber("");
    setValidFrom("");
    setValidUntil("");
    setDocFile(null);
    setNotes("");
    setError(null);
  }

  function onAttach() {
    if (!pickedCert) return;
    setError(null);
    startTransition(async () => {
      const res = await attachVendorCertificateAction(vendor.uuid, {
        certificate_id: pickedCert.id,
        certificate_number: certNumber.trim() || null,
        valid_from: validFrom || null,
        valid_until: validUntil || null,
        document_file_id: docFile?.id ?? null,
        notes: notes.trim() || null,
      });
      if (res.ok) {
        toast.success("Certificate attached");
        setOpen(false);
        resetForm();
        router.refresh();
      } else {
        setError({ detail: res.detail, code: res.code, debug: res.debug });
      }
    });
  }

  function onRemove(rowUuid: string) {
    startTransition(async () => {
      const res = await removeVendorCertificateAction(vendor.uuid, rowUuid);
      if (res.ok) {
        toast.success("Certificate removed");
        router.refresh();
      } else {
        toast.error(res.detail);
      }
    });
  }

  return (
    <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      <header className="mb-3 flex items-center gap-2">
        <Award className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold tracking-tight">
          Certificates on file
        </h2>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {vendor.certificates.length}
        </span>
      </header>

      {vendor.certificates.length === 0 ? (
        <p className="rounded-md border border-dashed border-border/60 px-3 py-6 text-center text-xs text-muted-foreground">
          No certificates on file yet. Attach GMP / BRC / FSSC / halal /
          kosher / organic as the vendor provides them.
        </p>
      ) : (
        <ul className="divide-y divide-border/60">
          {vendor.certificates.map((row) => {
            const expiresMs = row.valid_until
              ? new Date(row.valid_until).getTime()
              : null;
            const days =
              expiresMs !== null
                ? Math.round((expiresMs - Date.now()) / (24 * 60 * 60 * 1000))
                : null;
            const tone =
              days === null
                ? "muted"
                : days < 0
                  ? "destructive"
                  : days <= 30
                    ? "amber"
                    : "emerald";

            return (
              <li
                key={row.uuid}
                className="flex flex-wrap items-center justify-between gap-2 py-3"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="truncate text-sm font-medium">
                    {row.certificate?.uuid ? (
                      <Link
                        href={`/settings/certificates/${row.certificate.uuid}`}
                        className="underline-offset-2 hover:underline"
                      >
                        {row.certificate.name}
                      </Link>
                    ) : (
                      row.certificate?.name ?? "(unlinked)"
                    )}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    {row.certificate_number && (
                      <span className="font-mono">{row.certificate_number}</span>
                    )}
                    {row.valid_until && (
                      <span className="inline-flex items-center gap-1">
                        <CalendarRange className="size-3" />
                        until {row.valid_until}
                      </span>
                    )}
                    {row.document_file && (
                      <a
                        href={row.document_file.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={row.document_file.filename}
                        className="inline-flex max-w-[200px] items-center gap-1 text-foreground underline-offset-4 hover:underline"
                      >
                        <Paperclip className="size-3 shrink-0" />
                        <span className="truncate">
                          {truncateMiddle(row.document_file.filename, 24)}
                        </span>
                        <Download className="size-3 shrink-0 text-muted-foreground" />
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={tone}>
                    {days === null
                      ? "No expiry"
                      : days < 0
                        ? "Expired"
                        : `${days}d`}
                  </Badge>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => onRemove(row.uuid)}
                      disabled={pending}
                      className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label="Remove"
                    >
                      <X className="size-4" />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {canEdit && (
        <div className="mt-4">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              resetForm();
              setOpen(true);
            }}
          >
            <Plus className="mr-1.5 size-4" />
            Attach certificate
          </Button>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Attach certificate</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Certificate type
              </Label>
              <SearchPicker<CertOption>
                fetcher={fetchCertificates}
                value={pickedCert}
                onChange={setPickedCert}
                placeholder="Search certificates by name or issuing body…"
                emptyHint="No certificates match — adjust the search."
                excludeIds={attachedCertIds}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Certificate number
              </Label>
              <Input
                value={certNumber}
                onChange={(e) => setCertNumber(e.target.value)}
                placeholder="As shown on the certificate"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Valid from
                </Label>
                <Input
                  type="date"
                  value={validFrom}
                  onChange={(e) => setValidFrom(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Valid until
                </Label>
                <DerivedDateField
                  computed={addMonths(
                    validFrom,
                    pickedCert?.defaultValidityMonths ?? null,
                  )}
                  value={validUntil}
                  onChange={setValidUntil}
                  derivationHint={
                    pickedCert?.defaultValidityMonths
                      ? `Valid from + ${pickedCert.defaultValidityMonths}mo`
                      : "Pick a certificate type"
                  }
                  reasonComputedMissing="Pick cert type + set valid-from to auto-calculate."
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Certificate file
              </Label>
              <FileUploadField
                vendorUuid={vendor.uuid}
                kind="certificate"
                file={docFile}
                onChange={setDocFile}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Notes
              </Label>
              <Textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            {error && (
              <ErrorBanner
                detail={error.detail}
                code={error.code}
                debug={error.debug}
              />
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={onAttach} disabled={pending || !pickedCert}>
              {pending && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              Attach
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
