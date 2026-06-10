@AGENTS.md

# Rendering rule — never hardcode locale

Every date, quantity, money value, separator, and currency symbol the
operator sees MUST come from the company settings. Hardcoded formats
(`toLocaleDateString("en-GB", …)`, manual `.toFixed(2)`, baked-in
`£` / commas) drift from the company's `/settings/company` choices and
make the UI lie to the operator.

The single source of truth is `src/lib/format/company.ts`:

- `formatCompanyDate(iso, prefs)` — dates, honours `date_format`
  (`dd/MM/yyyy`, `MM/dd/yyyy`, `yyyy-MM-dd`, `dd.MM.yyyy`).
- `formatCompanyNumber(value, prefs)` — quantities, honours
  `decimal_separator` + `thousands_separator`.
- `formatCompanyMoney(value, prefs)` — money, honours the above plus
  `currency_code` + `currency_format` (sign placement).

`prefs` is the `CompanyDefaults` blob from `getCompanyDefaults()`.
Server components fetch it once and pass it down to client components
as a prop — never call the API from a client component just to format
a number.

When you write a new surface that renders any of the above, the page
component MUST:

1. `await getCompanyDefaults()` server-side.
2. Pass it through to the rendering component.
3. The renderer calls the helpers above.

When you find a surface that still hardcodes formatting, fix it in
the same change rather than leaving it for later — the rule is
"company settings, everywhere, always".
