// URL serialisation for DataTable's structured column filters.
//
// Shape lands on the backend as
//
//   column_filter[field][op]=<contains|eq|in|range>
//   column_filter[field][value]=<string>          # contains / eq
//   column_filter[field][value][]=<v1>&…          # in
//   column_filter[field][min|max|from|to]=<v>     # range
//
// The Backend.ListQueries.apply_column_filters/3 helper parses this
// shape verbatim (Plug decodes nested brackets into a nested map).
//
// Kept dumb — 61 fetchers call this helper so a URL layout change only
// needs one edit. Any fetcher that doesn't need column filters can
// simply omit the call.

import type { ColumnFilterValue } from "@/components/data-table";

export function serializeColumnFilters(
  qs: URLSearchParams,
  columnFilters: Record<string, ColumnFilterValue>,
): void {
  for (const [field, fv] of Object.entries(columnFilters)) {
    if (!fv) continue;
    qs.set(`column_filter[${field}][op]`, fv.op);

    switch (fv.op) {
      case "contains":
      case "eq":
        qs.set(`column_filter[${field}][value]`, String(fv.value));
        break;

      case "in":
        for (const v of fv.value) {
          qs.append(`column_filter[${field}][value][]`, String(v));
        }
        break;

      case "range":
        if ("min" in fv && fv.min !== undefined) {
          qs.set(`column_filter[${field}][min]`, String(fv.min));
        }
        if ("max" in fv && fv.max !== undefined) {
          qs.set(`column_filter[${field}][max]`, String(fv.max));
        }
        if ("from" in fv && fv.from) {
          qs.set(`column_filter[${field}][from]`, fv.from);
        }
        if ("to" in fv && fv.to) {
          qs.set(`column_filter[${field}][to]`, fv.to);
        }
        break;
    }
  }
}
