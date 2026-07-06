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
