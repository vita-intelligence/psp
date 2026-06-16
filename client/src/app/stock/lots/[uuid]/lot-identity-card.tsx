import type { StockLot } from "@/lib/types";
import { formatCompanyDate, formatCompanyMoney } from "@/lib/format/company";
import { getCompanyDefaults } from "@/lib/company/server";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  FileWarning,
  Snowflake,
} from "lucide-react";
import { computeLotHandlingTags } from "@/lib/stock/handling-tags";

/**
 * Read-only identity card: supplier batch, country, source, dates,
 * cost. Edits will land in D.1.4 — for now this just renders the
 * snapshot so operators have somewhere to look.
 */
export async function LotIdentityCard({ lot }: { lot: StockLot }) {
  const prefs = await getCompanyDefaults();

  return (
    <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      <header className="mb-4 flex items-center gap-2">
        <FileText className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold tracking-tight">Identity</h2>
      </header>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
        <Row label="Supplier batch" value={lot.supplier_batch_no} mono />
        <Row label="Country of origin" value={lot.country_of_origin} />
        <Row
          label="Source"
          value={
            lot.source_kind
              ? `${lot.source_kind.replace(/_/g, " ")}${
                  lot.source_ref ? ` · ${lot.source_ref}` : ""
                }`
              : null
          }
        />
        <Row label="Revision" value={lot.revision} mono />
        <Row
          label="Manufactured"
          value={
            lot.manufactured_at ? formatCompanyDate(lot.manufactured_at, prefs) : null
          }
        />
        <Row
          label="Expires"
          value={lot.expiry_at ? formatCompanyDate(lot.expiry_at, prefs) : null}
          accent={!!lot.expiry_at}
        />
        <Row
          label="Available from"
          value={
            lot.available_from ? formatCompanyDate(lot.available_from, prefs) : null
          }
        />
        <Row
          label="Unit cost"
          value={
            lot.unit_cost != null
              ? formatCompanyMoney(lot.unit_cost, prefs, {
                  currency_code: lot.currency ?? undefined,
                })
              : null
          }
          mono
        />
      </dl>

      <HandlingTags lot={lot} />

      {lot.notes && (
        <div className="mt-4 rounded-md border border-border/40 bg-muted/30 px-3 py-2">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Notes
          </div>
          <p className="mt-1 whitespace-pre-wrap text-sm">{lot.notes}</p>
        </div>
      )}
    </section>
  );
}

// Inline handling chips — driven off the item's `storage_tags` +
// `compliance_status` + cold-chain attribute. Mirrors the chip set
// the mobile pre-receive checklist renders so operators see the
// same flags regardless of which surface they're on.
function HandlingTags({ lot }: { lot: StockLot }) {
  const tags = computeLotHandlingTags(lot.item);
  if (tags.length === 0) return null;

  return (
    <div className="mt-4 space-y-1.5">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
        Handling
      </div>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag) => {
          const Icon = HANDLING_ICON[tag.icon];
          return (
            <span
              key={tag.key}
              title={tag.title}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${tag.className}`}
            >
              {Icon ? <Icon className="size-2.5" /> : null}
              {tag.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

const HANDLING_ICON = {
  alert: AlertTriangle,
  check: CheckCircle2,
  warning: FileWarning,
  cold: Snowflake,
} as const;

function Row({
  label,
  value,
  mono,
  accent,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd
        className={`mt-0.5 truncate text-sm ${mono ? "font-mono" : ""} ${
          accent ? "font-medium" : ""
        } ${value ? "" : "text-muted-foreground/50"}`}
      >
        {value ?? "—"}
      </dd>
    </div>
  );
}
