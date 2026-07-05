"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileText,
  FlaskConical,
  Loader2,
  Microscope,
  Paperclip,
  Pencil,
  Trash2,
  Upload,
} from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge-mini";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Switch } from "@/components/ui/switch";
import { ErrorBanner } from "@/components/forms/error-banner";
import { usePageLeadership } from "@/components/realtime/page-lock-guard";
import type {
  Vendor,
  VendorAuditKind,
  VendorAuditOutcome,
  VendorFile,
} from "@/lib/types";
import type { ErrorDebug } from "@/lib/errors/types";
import {
  updateVendorQualificationAction,
  uploadVendorFileAction,
  type VendorQualificationInput,
} from "@/lib/vendors/actions";

interface Props {
  vendor: Vendor;
  canEdit: boolean;
  pageId?: string;
}

type ArtifactKey = "saq" | "risk" | "audit" | "coa";

/**
 * Audit-defensible approved-supplier qualification checklist.
 *
 * Mirrors what BRCGS §3.5.1 / FSSC 22000 §7.1.6 / GFSI / 21 CFR 111
 * auditors expect to see on file before a vendor is signed off:
 * SAQ + risk assessment + facility audit (where required by risk
 * class) + COA sample for raw materials. Plus the periodic review
 * cadence that drives re-qualification.
 *
 * Each artifact is its own little dialog so the QA reviewer can
 * record evidence piecewise as it comes in, without re-typing the
 * other artifacts. Every save stamps `qualified_by` / `qualified_at`
 * server-side so the approve transition can enforce segregation of
 * duties (different signer from whoever collected the evidence).
 */
export function VendorQualificationCard({ vendor, canEdit, pageId }: Props) {
  const router = useRouter();
  const { isLeader, leader } = usePageLeadership(pageId ?? "", !pageId);
  const locked = !!pageId && !isLeader && !!leader;
  const effectiveCanEdit = canEdit && !locked;
  const [openArtifact, setOpenArtifact] = useState<ArtifactKey | null>(null);

  const q = vendor.qualification;
  const complete = q["complete?"];

  return (
    <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold tracking-tight">
              Qualification artifacts
            </h2>
            {complete ? (
              <Badge tone="emerald">Ready to approve</Badge>
            ) : (
              <Badge tone="amber">
                {q.missing.length} item{q.missing.length === 1 ? "" : "s"} outstanding
              </Badge>
            )}
            {vendor.review_overdue && (
              <Badge tone="destructive">Re-qualification overdue</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            BRCGS / FSSC 22000 / GFSI checklist. Approval is gated on
            every item being collected before a director can sign off.
          </p>
          {vendor.qualified_by && vendor.qualified_at && (
            <p className="text-[11px] text-muted-foreground">
              Last evidence recorded by{" "}
              <span className="font-medium text-foreground">
                {vendor.qualified_by.name}
              </span>{" "}
              on {new Date(vendor.qualified_at).toLocaleDateString()}
            </p>
          )}
        </div>
      </header>

      {!complete && (
        <div className="mt-4 rounded-md border border-amber-300/60 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="space-y-1">
              <p className="text-xs font-medium text-amber-900 dark:text-amber-200">
                What's blocking approval
              </p>
              <ul className="space-y-0.5 text-[11px] text-amber-900/90 dark:text-amber-200/90">
                {q.missing.map((m) => (
                  <li key={m.key}>
                    <span className="font-medium">{m.label}</span> — {m.reason}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <ArtifactRow
          icon={<FileText className="size-4" />}
          title="Supplier Approval Questionnaire"
          subtitle="MA-SUP-001 or equivalent"
          collectedAt={vendor.saq_received_at}
          file={vendor.saq_file}
          canEdit={effectiveCanEdit}
          onEdit={() => setOpenArtifact("saq")}
        />
        <ArtifactRow
          icon={<FlaskConical className="size-4" />}
          title="Risk assessment"
          subtitle={
            vendor.vendor_risk
              ? `Class: ${vendor.vendor_risk}`
              : "Risk class not set"
          }
          collectedAt={vendor.risk_assessment_completed_at}
          file={null}
          canEdit={effectiveCanEdit}
          onEdit={() => setOpenArtifact("risk")}
        />
        <ArtifactRow
          icon={<Microscope className="size-4" />}
          title={
            vendor.audit_required ? "Facility audit" : "Facility audit (waived)"
          }
          subtitle={
            vendor.audit_outcome
              ? `${vendor.audit_kind ?? "audit"} — ${formatOutcome(vendor.audit_outcome)}`
              : vendor.audit_required
                ? "Required for medium-/high-risk vendor"
                : "Waived — low-risk vendor"
          }
          collectedAt={vendor.audit_completed_at}
          file={vendor.audit_file}
          canEdit={effectiveCanEdit}
          onEdit={() => setOpenArtifact("audit")}
        />
        <ArtifactRow
          icon={<CheckCircle2 className="size-4" />}
          title="COA / specification sample"
          subtitle="Required for raw materials"
          collectedAt={vendor.coa_received_at}
          file={vendor.coa_file}
          canEdit={effectiveCanEdit}
          onEdit={() => setOpenArtifact("coa")}
        />
      </div>

      {openArtifact && (
        <ArtifactDialog
          vendor={vendor}
          artifact={openArtifact}
          open={!!openArtifact}
          onClose={() => setOpenArtifact(null)}
          onSaved={() => {
            setOpenArtifact(null);
            router.refresh();
          }}
        />
      )}
    </section>
  );
}

function ArtifactRow({
  icon,
  title,
  subtitle,
  collectedAt,
  file,
  canEdit,
  onEdit,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  collectedAt: string | null;
  file: VendorFile | null;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const done = !!collectedAt;
  return (
    <div
      className={`flex items-start gap-3 rounded-md border p-3 ${
        done
          ? "border-emerald-300/60 bg-emerald-50/40 dark:border-emerald-500/30 dark:bg-emerald-500/5"
          : "border-border/50 bg-muted/20"
      }`}
    >
      <div
        className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ${
          done
            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
            : "bg-muted text-muted-foreground"
        }`}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="truncate text-xs font-medium">{title}</p>
        <p className="truncate text-[11px] text-muted-foreground">{subtitle}</p>
        {done && (
          <p className="text-[11px] text-muted-foreground">
            Recorded {new Date(collectedAt!).toLocaleDateString()}
          </p>
        )}
        {file && (
          <a
            href={file.url}
            target="_blank"
            rel="noreferrer"
            title={`${file.filename} · ${formatBytes(file.byte_size)}`}
            className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border/60 bg-background px-2 py-1 text-[11px] hover:bg-muted"
          >
            <Paperclip className="size-3 shrink-0" />
            <span className="truncate">{truncateMiddle(file.filename, 30)}</span>
            <span className="shrink-0 text-muted-foreground">
              · {formatBytes(file.byte_size)}
            </span>
            <Download className="size-3 shrink-0 text-muted-foreground" />
          </a>
        )}
      </div>
      {canEdit && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onEdit}
          className="h-7 px-2"
        >
          <Pencil className="size-3.5" />
        </Button>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Middle-truncates long filenames so the prefix + extension stay
 * visible (`content-block-…-uk-eu (3).pdf`). CSS `truncate` only
 * cuts the end which hides the extension — that matters for
 * audit-evidence files where the file type is the giveaway.
 */
export function truncateMiddle(s: string, max: number): string {
  if (s.length <= max) return s;
  const half = Math.floor((max - 1) / 2);
  return `${s.slice(0, half)}…${s.slice(s.length - half)}`;
}

function formatOutcome(o: VendorAuditOutcome): string {
  return {
    pass: "Pass",
    pass_with_findings: "Pass with findings",
    fail: "FAIL",
  }[o];
}

function ArtifactDialog({
  vendor,
  artifact,
  open,
  onClose,
  onSaved,
}: {
  vendor: Vendor;
  artifact: ArtifactKey;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<{
    detail: string;
    code?: string;
    debug?: ErrorDebug;
  } | null>(null);

  // Form state per artifact.
  const [saqDate, setSaqDate] = useState(vendor.saq_received_at ?? "");
  const [saqFile, setSaqFile] = useState<VendorFile | null>(vendor.saq_file);
  const [riskDate, setRiskDate] = useState(
    vendor.risk_assessment_completed_at ?? "",
  );
  const [riskNotes, setRiskNotes] = useState(
    vendor.risk_assessment_notes ?? "",
  );
  const [auditRequired, setAuditRequired] = useState(vendor.audit_required);
  const [auditDate, setAuditDate] = useState(vendor.audit_completed_at ?? "");
  const [auditKind, setAuditKind] = useState<VendorAuditKind | "">(
    vendor.audit_kind ?? "",
  );
  const [auditOutcome, setAuditOutcome] = useState<VendorAuditOutcome | "">(
    vendor.audit_outcome ?? "",
  );
  const [auditFile, setAuditFile] = useState<VendorFile | null>(
    vendor.audit_file,
  );
  const [auditNotes, setAuditNotes] = useState(vendor.audit_notes ?? "");
  const [coaDate, setCoaDate] = useState(vendor.coa_received_at ?? "");
  const [coaFile, setCoaFile] = useState<VendorFile | null>(vendor.coa_file);

  function buildInput(): VendorQualificationInput {
    switch (artifact) {
      case "saq":
        return {
          saq_received_at: saqDate || null,
          saq_file_id: saqFile?.id ?? null,
        };
      case "risk":
        return {
          risk_assessment_completed_at: riskDate || null,
          risk_assessment_notes: riskNotes.trim() || null,
        };
      case "audit":
        return {
          audit_required: auditRequired,
          audit_completed_at: auditDate || null,
          audit_kind: (auditKind || null) as VendorAuditKind | null,
          audit_outcome: (auditOutcome || null) as VendorAuditOutcome | null,
          audit_file_id: auditFile?.id ?? null,
          audit_notes: auditNotes.trim() || null,
        };
      case "coa":
        return {
          coa_received_at: coaDate || null,
          coa_file_id: coaFile?.id ?? null,
        };
    }
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await updateVendorQualificationAction(
        vendor.uuid,
        buildInput(),
      );
      if (res.ok) {
        toast.success("Evidence recorded");
        onSaved();
      } else {
        setError({ detail: res.detail, code: res.code, debug: res.debug });
      }
    });
  }

  const TITLE: Record<ArtifactKey, string> = {
    saq: "Supplier Approval Questionnaire",
    risk: "Risk assessment",
    audit: "Facility audit",
    coa: "COA / specification sample",
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader className="space-y-1">
          <DialogTitle className="text-sm font-semibold">
            {TITLE[artifact]}
          </DialogTitle>
          <DialogDescription className="text-[11px] leading-snug">
            Saving stamps you as the evidence collector — sign-off must
            come from a different reviewer.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2.5">
          {artifact === "saq" && (
            <>
              <Field label="Date received">
                <Input
                  type="date"
                  value={saqDate}
                  onChange={(e) => setSaqDate(e.target.value)}
                />
              </Field>
              <Field label="Questionnaire file">
                <FileUploadField
                  vendorUuid={vendor.uuid}
                  kind="saq"
                  file={saqFile}
                  onChange={setSaqFile}
                />
              </Field>
            </>
          )}

          {artifact === "risk" && (
            <>
              <Field label="Date completed">
                <Input
                  type="date"
                  value={riskDate}
                  onChange={(e) => setRiskDate(e.target.value)}
                />
              </Field>
              <Field label="Notes">
                <Textarea
                  rows={4}
                  value={riskNotes}
                  onChange={(e) => setRiskNotes(e.target.value)}
                  placeholder="Risk factors, mitigations, justification for the risk class…"
                />
              </Field>
              <p className="text-[11px] text-muted-foreground">
                Set the <strong>risk class</strong> (low / medium / high)
                on the vendor edit form — it drives whether a facility
                audit is required.
              </p>
            </>
          )}

          {artifact === "audit" && (
            <>
              <Field label="Audit required for this vendor">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={auditRequired}
                    onCheckedChange={setAuditRequired}
                  />
                  <span className="text-xs text-muted-foreground">
                    {auditRequired
                      ? "Required — must be collected before approval"
                      : "Waived (low-risk / documentary only)"}
                  </span>
                </div>
              </Field>
              {auditRequired && (
                <>
                  <Field label="Date completed">
                    <Input
                      type="date"
                      value={auditDate}
                      onChange={(e) => setAuditDate(e.target.value)}
                    />
                  </Field>
                  <Field label="Kind">
                    <Select
                      value={auditKind || undefined}
                      onValueChange={(v) =>
                        setAuditKind(v as VendorAuditKind)
                      }
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="Pick audit kind" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="desk">Desk-based</SelectItem>
                        <SelectItem value="virtual">Virtual</SelectItem>
                        <SelectItem value="onsite">On-site</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Outcome">
                    <Select
                      value={auditOutcome || undefined}
                      onValueChange={(v) =>
                        setAuditOutcome(v as VendorAuditOutcome)
                      }
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="Pick outcome" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pass">Pass</SelectItem>
                        <SelectItem value="pass_with_findings">
                          Pass with findings
                        </SelectItem>
                        <SelectItem value="fail">Fail</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Audit report">
                    <FileUploadField
                      vendorUuid={vendor.uuid}
                      kind="audit"
                      file={auditFile}
                      onChange={setAuditFile}
                    />
                  </Field>
                  <Field label="Findings / notes">
                    <Textarea
                      rows={3}
                      value={auditNotes}
                      onChange={(e) => setAuditNotes(e.target.value)}
                    />
                  </Field>
                </>
              )}
            </>
          )}

          {artifact === "coa" && (
            <>
              <Field label="Date received">
                <Input
                  type="date"
                  value={coaDate}
                  onChange={(e) => setCoaDate(e.target.value)}
                />
              </Field>
              <Field label="COA / spec file">
                <FileUploadField
                  vendorUuid={vendor.uuid}
                  kind="coa"
                  file={coaFile}
                  onChange={setCoaFile}
                />
              </Field>
            </>
          )}

          {error && (
            <ErrorBanner
              detail={error.detail}
              code={error.code}
              debug={error.debug}
            />
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={pending}>
            {pending && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
            Save evidence
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

export function FileUploadField({
  vendorUuid,
  kind,
  file,
  onChange,
}: {
  vendorUuid: string;
  kind: "saq" | "audit" | "coa" | "certificate";
  file: VendorFile | null;
  onChange: (f: VendorFile | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, startUpload] = useTransition();
  const [uploadError, setUploadError] = useState<string | null>(null);

  function handlePick(picked: File | undefined) {
    if (!picked) return;
    const fd = new FormData();
    fd.append("kind", kind);
    fd.append("file", picked);

    setUploadError(null);
    startUpload(async () => {
      const res = await uploadVendorFileAction(vendorUuid, fd);
      if (res.ok) {
        onChange(res.file);
        toast.success(`Uploaded ${res.file.filename}`);
      } else {
        setUploadError(res.detail);
      }
    });
  }

  if (file) {
    return (
      <div className="flex w-full min-w-0 items-center gap-1.5 rounded-md border border-border/60 bg-muted/30 px-2 py-1.5">
        <Paperclip className="size-3 shrink-0 text-muted-foreground" />
        <a
          href={file.url}
          target="_blank"
          rel="noreferrer"
          title={`${file.filename} · ${formatBytes(file.byte_size)}`}
          className="min-w-0 flex-1 truncate text-[11px] hover:underline"
        >
          {truncateMiddle(file.filename, 28)}
        </a>
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label="Remove file"
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
        >
          <Trash2 className="size-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp,.doc,.docx,.xls,.xlsx,.txt"
        className="hidden"
        onChange={(e) => handlePick(e.target.files?.[0])}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="h-8 w-full text-xs"
      >
        {uploading ? (
          <Loader2 className="mr-1.5 size-3.5 animate-spin" />
        ) : (
          <Upload className="mr-1.5 size-3.5" />
        )}
        {uploading ? "Uploading…" : "Upload file"}
      </Button>
      {uploadError && (
        <p className="text-[10px] text-destructive">{uploadError}</p>
      )}
      <p className="text-[10px] text-muted-foreground">
        PDF, image, Word, Excel, or text · max 20 MB
      </p>
    </div>
  );
}
