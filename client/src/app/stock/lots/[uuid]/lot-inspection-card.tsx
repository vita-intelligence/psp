"use client";

/**
 * Goods-In Inspection summary rendered on a lot detail page when
 * the lot came from a PO receive. Shows:
 *   * Delivery context (PO, transport, vehicle, seal)
 *   * Five inspection sections (pass/fail rollup from the JSON bag)
 *   * Quality decision + reason
 *   * Operator + approver signatures (image + timestamp)
 *   * Attached files (CoA + photos) with lightbox + download
 *
 * Read-only — the inspection itself is edited on the mobile wizard.
 * The lot detail page treats it as a frozen audit artefact.
 */

import { useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  ExternalLink,
  FileText,
  ImageIcon,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import type { GoodsInInspectionFull } from "@/lib/types";
import { formatCompanyDate, type FormatPrefs } from "@/lib/format/company";

const SECTION_LABELS: Array<{
  key: keyof Pick<
    GoodsInInspectionFull,
    | "vehicle_inspection"
    | "documentation_verification"
    | "physical_inspection"
    | "food_safety_checks"
    | "storage_verification"
  >;
  label: string;
}> = [
  { key: "vehicle_inspection", label: "Vehicle" },
  { key: "documentation_verification", label: "Documentation" },
  { key: "physical_inspection", label: "Physical" },
  { key: "food_safety_checks", label: "Food safety" },
  { key: "storage_verification", label: "Storage" },
];

const DECISION_TONE: Record<string, string> = {
  approved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  hold: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  rejected: "bg-red-500/15 text-red-700 dark:text-red-300",
};

interface SectionCheck {
  /** Wizard writes `passed: bool` per check. `ok` / `value` kept for
   *  legacy shapes from earlier inspection versions. */
  passed?: boolean | null;
  ok?: boolean | null;
  value?: boolean | string | null;
  note?: string | null;
  notes?: string | null;
  comment?: string | null;
}

function sectionRollup(bag: Record<string, unknown> | null): {
  total: number;
  passed: number;
} {
  if (!bag || typeof bag !== "object") return { total: 0, passed: 0 };
  const entries = Object.values(bag);
  let total = 0;
  let passed = 0;
  for (const v of entries) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const c = v as SectionCheck;
      const pass =
        c.passed === true || c.ok === true || c.value === true ||
        (typeof c.value === "string" && c.value.length > 0);
      const fail =
        c.passed === false || c.ok === false || c.value === false;
      if (pass) {
        total++;
        passed++;
      } else if (fail) {
        total++;
      }
    } else if (typeof v === "boolean") {
      total++;
      if (v) passed++;
    }
  }
  return { total, passed };
}

export function LotInspectionCard({
  inspection,
  prefs,
}: {
  inspection: GoodsInInspectionFull;
  prefs: FormatPrefs;
}) {
  const [open, setOpen] = useState(true);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const decisionTone =
    DECISION_TONE[inspection.quality_decision ?? ""] ??
    "bg-muted text-muted-foreground";

  const files = inspection.files ?? [];
  const photos = files.filter((f) => f.kind === "photo");
  const docs = files.filter((f) => f.kind !== "photo");

  return (
    <section className="rounded-lg border border-border/60 bg-card shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold tracking-tight">
            Goods-In Inspection
          </h2>
          {inspection.code && (
            <span className="font-mono text-[11px] text-muted-foreground">
              {inspection.code}
            </span>
          )}
          {inspection.quality_decision && (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${decisionTone}`}
            >
              {inspection.quality_decision}
            </span>
          )}
        </div>
        {open ? (
          <ChevronUp className="size-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="size-4 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="space-y-4 border-t border-border/60 px-5 py-4">
          {/* Delivery context */}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
            <Cell label="Delivery date">
              {inspection.delivery_date
                ? formatCompanyDate(inspection.delivery_date, prefs)
                : "—"}
            </Cell>
            <Cell label="Delivery time">
              {inspection.delivery_time ?? "—"}
            </Cell>
            <Cell label="Transport">
              {inspection.transport_company ?? "—"}
            </Cell>
            <Cell label="Vehicle reg">
              {inspection.vehicle_registration ?? "—"}
            </Cell>
            <Cell label="Seal #">{inspection.seal_number ?? "—"}</Cell>
            <Cell label="PO">
              {inspection.purchase_order_uuid ? (
                <Link
                  href={`/procurement/purchase-orders/${inspection.purchase_order_uuid}`}
                  className="inline-flex items-center gap-1 text-brand hover:underline"
                >
                  View
                  <ExternalLink className="size-3" />
                </Link>
              ) : (
                "—"
              )}
            </Cell>
          </dl>

          {/* Section rollup */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {SECTION_LABELS.map(({ key, label }) => {
              const { total, passed } = sectionRollup(inspection[key]);
              const allPassed = total > 0 && passed === total;
              const empty = total === 0;
              return (
                <div
                  key={key}
                  className={`rounded-md border p-2 text-[11px] ${
                    empty
                      ? "border-border/40 bg-muted/30 text-muted-foreground"
                      : allPassed
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200"
                        : "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200"
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-medium">{label}</span>
                    {empty ? (
                      <span className="text-[10px]">—</span>
                    ) : allPassed ? (
                      <CheckCircle2 className="size-3" />
                    ) : (
                      <XCircle className="size-3" />
                    )}
                  </div>
                  <p className="mt-0.5 font-mono text-[10px] opacity-80">
                    {empty ? "no checks" : `${passed}/${total}`}
                  </p>
                </div>
              );
            })}
          </div>

          {inspection.quality_decision_reason && (
            <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-[11px] leading-relaxed">
              <p className="mb-0.5 font-semibold uppercase tracking-wide text-muted-foreground">
                Decision note
              </p>
              {inspection.quality_decision_reason}
            </div>
          )}

          {/* Signatures */}
          <div className="grid gap-3 sm:grid-cols-2">
            <SignatureCard
              role="Goods-in operator"
              actor={inspection.goods_in_operator}
              signedAt={inspection.goods_in_operator_signed_at}
              image={inspection.goods_in_operator_signature_image}
              prefs={prefs}
            />
            <SignatureCard
              role="Quality approver"
              actor={inspection.quality_approver}
              signedAt={inspection.quality_approver_signed_at}
              image={inspection.quality_approver_signature_image}
              prefs={prefs}
            />
          </div>

          {/* Files: photos as thumbs, docs as links */}
          {(photos.length > 0 || docs.length > 0) && (
            <div className="space-y-2">
              <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <ClipboardCheck className="size-3" />
                Attached files ({photos.length + docs.length})
              </h3>
              {photos.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {photos.map((p) => (
                    <button
                      key={p.uuid}
                      type="button"
                      onClick={() => p.url && setLightbox(p.url)}
                      className="overflow-hidden rounded-md border border-border/60 transition-colors hover:border-foreground/30"
                      title={p.filename}
                    >
                      {p.url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.url}
                          alt={p.filename}
                          className="size-16 object-cover"
                        />
                      ) : (
                        <span className="inline-flex size-16 items-center justify-center text-muted-foreground">
                          <ImageIcon className="size-5" />
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              {docs.length > 0 && (
                <ul className="space-y-1">
                  {docs.map((d) => (
                    <li key={d.uuid} className="text-xs">
                      <a
                        href={d.url ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-brand hover:underline"
                      >
                        <FileText className="size-3" />
                        {d.filename}
                        <span className="text-[10px] text-muted-foreground">
                          · {d.kind}
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      <Dialog open={!!lightbox} onOpenChange={(o) => !o && setLightbox(null)}>
        <DialogContent className="max-w-3xl border-0 bg-transparent p-0 shadow-none">
          <DialogTitle className="sr-only">Inspection photo</DialogTitle>
          {lightbox && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={lightbox}
              alt="Inspection photo, full size"
              className="max-h-[80vh] w-full rounded-md object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function Cell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  );
}

function SignatureCard({
  role,
  actor,
  signedAt,
  image,
  prefs,
}: {
  role: string;
  actor: { id: number; name: string; email: string } | null;
  signedAt: string | null;
  image: string | null;
  prefs: FormatPrefs;
}) {
  if (!actor || !signedAt) {
    return (
      <div className="rounded-md border border-dashed border-border/60 bg-muted/20 px-3 py-3 text-[11px] text-muted-foreground">
        <p className="font-semibold uppercase tracking-wide">{role}</p>
        <p className="mt-1">Not signed</p>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-border/60 bg-card px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {role}
      </p>
      <p className="mt-0.5 text-xs font-medium">{actor.name}</p>
      <p className="text-[10px] text-muted-foreground">
        {formatCompanyDate(signedAt, prefs)}
      </p>
      {image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt={`Signature of ${actor.name}`}
          className="mt-2 h-12 w-auto rounded border border-border/40 bg-white object-contain p-1"
        />
      )}
    </div>
  );
}
