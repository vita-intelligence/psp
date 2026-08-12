/**
 * Locale formatters that read company defaults — one source of truth
 * for every place we render a date, quantity, or money value.
 *
 * Pure functions: they take an ISO string / decimal and a
 * `CompanyDefaults` (or just the relevant fields) and return a
 * formatted string. No reads from cookies / globals so they're
 * trivially callable from both server components and the client.
 *
 * If the company has no defaults (anonymous routes, brand-new install)
 * the helpers fall back to ISO + dot-decimal so behaviour stays
 * predictable.
 */

import { format as formatDateFns } from "date-fns";
import type { CompanyDefaults } from "../types";

/** A loose shape so callers can pass either the full CompanyDefaults
 *  or a hand-built `{date_format: "..."}`. */
export interface FormatPrefs {
  /** Tenant id — exposed so client-side helpers that need to scope
   *  a subscription per company (e.g. the entity-broadcast channel)
   *  can grab it via the same context that already carries locale. */
  id?: number | null;
  date_format?: string | null;
  decimal_separator?: string | null;
  thousands_separator?: string | null;
  currency_code?: string | null;
  currency_format?: string | null;
}

const DEFAULT_DATE_PATTERN = "dd/MM/yyyy";

/** "DD/MM/YYYY" style absolute date. `null` / unparsable input → "—". */
export function formatCompanyDate(
  iso: string | null | undefined,
  prefs: FormatPrefs | null | undefined,
): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const pattern = prefs?.date_format || DEFAULT_DATE_PATTERN;
  try {
    return formatDateFns(d, pattern);
  } catch {
    return formatDateFns(d, DEFAULT_DATE_PATTERN);
  }
}

/**
 * Quantity formatter — uses the company's decimal + thousands
 * separators. Drops trailing zeros so "5.00" reads as "5".
 *
 *     formatCompanyNumber("12345.6789", { decimal_separator: ",", thousands_separator: "." })
 *     // "12.345,6789"
 *
 * Sub-precision-preserving: when a non-zero input would round to
 * exactly 0 at ``maxFractionDigits`` (e.g. ``0.00000005`` with
 * ``maxFractionDigits: 6``), we fall back to ``toPrecision(2)`` so
 * the value survives — dropping a genuine non-zero to "0" on a BOM
 * cell is a data-integrity trap (a "0 kg" reading looks like an
 * empty line but the recipe actually requires trace amounts).
 */
export function formatCompanyNumber(
  value: string | number | null | undefined,
  prefs: FormatPrefs | null | undefined,
  opts: { maxFractionDigits?: number } = {},
): string {
  if (value === null || value === undefined) return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return String(value);

  const decimal = prefs?.decimal_separator || ".";
  const thousands = prefs?.thousands_separator || ",";
  const maxFrac = opts.maxFractionDigits ?? 4;

  // Trim trailing zeros first so "5.0000" → "5".
  let trimmed = Number(n.toFixed(maxFrac)).toString();

  // Rescue path: n is non-zero but rounded to "0" at requested
  // precision. Expand until we can express the value — up to 20
  // decimals (JS Number cap) via ``toPrecision`` on 2 significant
  // digits. Preserves the sign for negatives and swaps scientific
  // notation (``5e-8``) back to plain decimal (``0.00000005``) so
  // the operator sees a normal number.
  if (trimmed === "0" && n !== 0) {
    const precise = n.toPrecision(2);
    trimmed = Number(precise) === 0 ? String(n) : expandScientific(precise);
  }

  const [intPart, fracPart] = trimmed.split(".");

  const intGrouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
  return fracPart ? `${intGrouped}${decimal}${fracPart}` : intGrouped;
}

/** ``toPrecision(2)`` on ``0.00000005`` returns ``"5.0e-8"``; the BOM
 *  cell needs plain decimal so an operator scanning "0.00000005 kg"
 *  doesn't have to mentally parse exponents. Turns
 *  ``"5.0e-8"`` → ``"0.00000005"``. Negative numbers keep their sign;
 *  positive exponents (unlikely at this call-site) pass through
 *  unchanged since the intPart already carries them. */
function expandScientific(precise: string): string {
  const num = Number(precise);
  if (!Number.isFinite(num)) return precise;
  if (Math.abs(num) >= 1e-6) return num.toString();
  // For very small numbers, hand-format so JS doesn't reach for
  // scientific notation. ``Number.EPSILON`` (2.22e-16) is the floor;
  // anything below that is indistinguishable from 0 at Number
  // precision anyway.
  const sign = num < 0 ? "-" : "";
  const abs = Math.abs(num);
  const digits = abs.toExponential().replace(/e[+-]?\d+$/, "").replace(".", "");
  const exp = Number(abs.toExponential().match(/e([+-]?\d+)$/)?.[1] ?? "0");
  if (exp >= 0) return sign + digits;
  const zeros = "0".repeat(Math.max(0, -exp - 1));
  return `${sign}0.${zeros}${digits.replace(/0+$/, "")}`;
}

/**
 * MO-facing quantity formatter — always renders in kg for mass or
 * L for volume, no matter how the underlying line was stored. The
 * MO Parts breakdown reads like a batching sheet, and operators
 * asked for a single consistent unit across every row so
 * quantities are directly comparable and sum-able without mental
 * unit conversion.
 *
 * Conversion table (kept in the same place so every surface that
 * renders raw ingredient qty reads the same way):
 *
 *   mass:   mg → kg (÷ 1_000_000)
 *           g  → kg (÷ 1_000)
 *           kg → kg (identity)
 *   volume: ml → l  (÷ 1_000)
 *           l  → l  (identity)
 *   other:  count / unit / pcs / … pass through untouched
 *
 * ``maxFractionDigits`` — enough precision to keep tiny doses (a
 * 60 mg active = 0.00006 kg) distinguishable from zero when they
 * share a table with kg-scale bulk items. Formatted through the
 * company number formatter so the operator's decimal / thousands
 * separators still apply.
 */
export function formatQtyHumanized(
  value: string | number | null | undefined,
  uom: string | null | undefined,
  prefs: FormatPrefs | null | undefined,
): { value: string; unit: string } {
  const rawUnit = (uom ?? "").trim();
  if (value === null || value === undefined) {
    return { value: "—", unit: rawUnit };
  }
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) {
    return {
      value: formatCompanyNumber(value, prefs),
      unit: rawUnit,
    };
  }

  // Mass → kg, volume → l, everything else stays as-is.
  const lower = rawUnit.toLowerCase();
  let scaled = n;
  let unit = lower;
  switch (lower) {
    case "mg":
      scaled = n / 1_000_000;
      unit = "kg";
      break;
    case "g":
      scaled = n / 1_000;
      unit = "kg";
      break;
    case "kg":
      unit = "kg";
      break;
    case "ml":
      scaled = n / 1_000;
      unit = "l";
      break;
    case "l":
      unit = "l";
      break;
    default:
      // Unknown / count-based — leave the caller's original label
      // and value alone. Preserves the caller's casing so ``L`` /
      // ``Each`` / ``bottle`` render unchanged.
      return {
        value: formatCompanyNumber(value, prefs),
        unit: rawUnit,
      };
  }

  return {
    value: formatCompanyNumber(scaled, prefs, { maxFractionDigits: 6 }),
    unit,
  };
}


/**
 * Money formatter — combines the number formatter above with the
 * company's currency code + sign placement. Sign defaults to the
 * code's natural symbol where we have a mapping; otherwise the
 * three-letter code is used as-is (still 100% unambiguous on a
 * regulatory label).
 */
export function formatCompanyMoney(
  value: string | number | null | undefined,
  prefs: FormatPrefs | null | undefined,
  overrides: { currency_code?: string | null } = {},
): string {
  if (value === null || value === undefined) return "—";
  const number = formatCompanyNumber(value, prefs, { maxFractionDigits: 4 });
  if (number === "—") return number;

  const code = overrides.currency_code || prefs?.currency_code || "GBP";
  const sign = CURRENCY_SYMBOLS[code] || code;
  const layout = prefs?.currency_format || "[Sign] [Price]";

  switch (layout) {
    case "[Sign] [Price]":
      return `${sign} ${number}`;
    case "[Sign][Price]":
      return `${sign}${number}`;
    case "[Price] [Sign]":
      return `${number} ${sign}`;
    case "[Price][Sign]":
      return `${number}${sign}`;
    default:
      return `${sign} ${number}`;
  }
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  GBP: "£",
  EUR: "€",
  USD: "$",
  JPY: "¥",
  INR: "₹",
  CHF: "Fr",
  CAD: "$",
  AUD: "$",
};

/** Quick coercion helper so callers can pass `CompanyDefaults | null`
 *  without unwrapping every time. */
export function toFormatPrefs(
  defaults: CompanyDefaults | null | undefined,
): FormatPrefs {
  return defaults ?? {};
}
