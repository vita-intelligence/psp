"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { FormatPrefs } from "./company";

/**
 * Make company `date_format` / `decimal_separator` / `currency_*`
 * available to every client component without prop drilling. The
 * provider is hydrated once at the root layout from the server-side
 * `getCompanyDefaults()` fetch.
 *
 * Server components keep using the explicit `formatCompanyDate(iso,
 * defaults)` overload because hooks don't exist server-side.
 */
const CompanyPrefsContext = createContext<FormatPrefs>({});

export function CompanyPrefsProvider({
  prefs,
  children,
}: {
  prefs: FormatPrefs;
  children: ReactNode;
}) {
  // Stable identity so consumers don't re-render on every layout pass.
  const value = useMemo(() => prefs, [
    prefs.id,
    prefs.date_format,
    prefs.decimal_separator,
    prefs.thousands_separator,
    prefs.currency_code,
    prefs.currency_format,
  ]);
  return (
    <CompanyPrefsContext.Provider value={value}>
      {children}
    </CompanyPrefsContext.Provider>
  );
}

/** Read company locale settings inside any client component below
 *  the root layout. Empty prefs when the user isn't authed yet. */
export function useFormatPrefs(): FormatPrefs {
  return useContext(CompanyPrefsContext);
}
