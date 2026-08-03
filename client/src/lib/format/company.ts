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
  const trimmed = Number(n.toFixed(maxFrac)).toString();
  const [intPart, fracPart] = trimmed.split(".");

  const intGrouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
  return fracPart ? `${intGrouped}${decimal}${fracPart}` : intGrouped;
}

/**
 * Human-scale quantity formatter — takes a raw ``qty + uom`` pair
 * and auto-scales to the friendliest neighbouring unit so operators
 * aren't reading ``160,165 mg`` when ``160.16 g`` is more legible.
 *
 * Scaling rules (mass / volume only — count-based UoMs pass
 * through untouched):
 *
 *   mg → g (÷ 1_000)  when |qty| ≥ 1_000
 *   g  → kg (÷ 1_000) when |qty| ≥ 1_000
 *   ml → l  (÷ 1_000) when |qty| ≥ 1_000
 *
 * Returns the same shape the caller can splice into JSX:
 * ``{ value, unit }`` where ``value`` is already formatted per
 * company defaults. The rule chains — 1_500_000 mg → 1.5 kg —
 * because the caller can call the helper once and get the most
 * human unit without re-invoking. Kept in one place so every
 * surface that renders raw ingredient qty (MO parts table, stock
 * lot placements, spec sheet, …) reads the same way.
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

  // Chain: mg → g → kg  |  ml → l  |  everything else untouched.
  let scaled = n;
  let unit = rawUnit.toLowerCase();
  const step = (from: string, to: string): boolean => {
    if (unit === from && Math.abs(scaled) >= 1000) {
      scaled = scaled / 1000;
      unit = to;
      return true;
    }
    return false;
  };
  // Walk both chains until we can't step further.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (step("mg", "g")) continue;
    if (step("g", "kg")) continue;
    if (step("ml", "l")) continue;
    break;
  }

  return {
    value: formatCompanyNumber(scaled, prefs),
    // Restore the caller's original casing when we didn't scale
    // (so "L" stays "L", "mg" stays "mg"). When we did scale, use
    // our lowercase target since the SI form is universal.
    unit: unit === rawUnit.toLowerCase() ? rawUnit : unit,
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
