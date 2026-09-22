"use client";

import type {
  FormSubmissionPage,
  SubmissionFilters,
  SubmissionLookupItem,
  SubmissionLookupType,
} from "./types";

/** Client-side fetcher for the cursor-paginated submissions list.
 *  Called from the "Load more" hook on the sessions page. */
export async function fetchFormSubmissions(
  filters: SubmissionFilters,
  cursor: string | null,
  signal?: AbortSignal,
): Promise<FormSubmissionPage> {
  const qs = new URLSearchParams();
  const push = (key: string, value: string | number | undefined | null) => {
    if (value === undefined || value === null) return;
    const s = typeof value === "number" ? value.toString() : value.trim();
    if (!s) return;
    qs.set(key, s);
  };

  push("workstation_uuid", filters.workstation_uuid);
  push("equipment_uuid", filters.equipment_uuid);
  push("form_template_uuid", filters.form_template_uuid);
  push("workstation_session_uuid", filters.workstation_session_uuid);
  push("submitted_by_id", filters.submitted_by_id);
  push("submitted_by_uuid", filters.submitted_by_uuid);
  push("trigger", filters.trigger);
  push("activity_kind", filters.activity_kind);
  push("from", filters.from);
  push("to", filters.to);
  push("search", filters.search);
  if (cursor) qs.set("cursor", cursor);
  push("limit", filters.limit);

  const url = `/api/production/form-submissions${qs.toString() ? `?${qs.toString()}` : ""}`;

  const res = await fetch(url, { cache: "no-store", signal });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { detail?: string }
      | null;
    throw new Error(body?.detail ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as FormSubmissionPage;
}

/** Client-side typeahead fetcher for the four picker facets. Returns
 *  ``{items, nextCursor: null}`` — the backend caps at 20 rows per
 *  call and doesn't paginate; if a user needs more they narrow the
 *  query. */
export async function fetchSubmissionLookup(
  type: SubmissionLookupType,
  query: string,
  signal?: AbortSignal,
): Promise<{ items: SubmissionLookupItem[]; nextCursor: string | null }> {
  const qs = new URLSearchParams({ type, limit: "20" });
  if (query.trim()) qs.set("q", query.trim());

  const res = await fetch(
    `/api/production/form-submissions/lookups?${qs.toString()}`,
    { cache: "no-store", signal },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { detail?: string }
      | null;
    throw new Error(body?.detail ?? `HTTP ${res.status}`);
  }
  const { items } = (await res.json()) as { items: SubmissionLookupItem[] };
  return { items, nextCursor: null };
}
