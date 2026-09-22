import "server-only";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type {
  FormSubmissionDetail,
  FormSubmissionPage,
  SubmissionFilters,
  SubmissionLookupItem,
  SubmissionLookupType,
} from "./types";

function buildQuery(filters: SubmissionFilters): string {
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
  push("cursor", filters.cursor);
  push("limit", filters.limit);

  const s = qs.toString();
  return s ? `?${s}` : "";
}

export async function listFormSubmissions(
  filters: SubmissionFilters = {},
): Promise<FormSubmissionPage> {
  const token = await getSessionToken();
  const empty: FormSubmissionPage = { items: [], next_cursor: null, limit: 25 };
  if (!token) return empty;

  try {
    return await api<FormSubmissionPage>(
      `/api/production/form-submissions${buildQuery(filters)}`,
      { token, cache: "no-store" },
    );
  } catch {
    return empty;
  }
}

export async function getFormSubmission(
  uuid: string,
): Promise<FormSubmissionDetail | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    const { submission } = await api<{ submission: FormSubmissionDetail }>(
      `/api/production/form-submissions/${encodeURIComponent(uuid)}`,
      { token, cache: "no-store" },
    );
    return submission;
  } catch {
    return null;
  }
}

/** Resolve a preselected filter uuid to a friendly label via the same
 *  typeahead endpoint the browser combobox hits. Used so a URL like
 *  ``?workstation_uuid=abc`` still shows "Blending #1" on the trigger
 *  button without loading the full picker list. */
export async function resolveSubmissionLookup(
  type: SubmissionLookupType,
  uuid: string,
): Promise<SubmissionLookupItem | null> {
  const token = await getSessionToken();
  if (!token) return null;

  const qs = new URLSearchParams({ type, uuid, limit: "1" });
  try {
    const { items } = await api<{ items: SubmissionLookupItem[] }>(
      `/api/production/form-submissions/lookups?${qs.toString()}`,
      { token, cache: "no-store" },
    );
    return items[0] ?? null;
  } catch {
    return null;
  }
}
