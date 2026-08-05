import "server-only";

import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { OutputQcEntry, OutputQcQueuePage } from "../production/types";

export interface OutputQcQueueResponse extends OutputQcQueuePage {}

export interface OutputQcQueueOpts {
  limit?: number;
  cursor?: string | null;
  search?: string | null;
  item_type?: string | null;
  project_type?: string | null;
  workstation_group_uuid?: string | null;
}

function toQuery(opts: OutputQcQueueOpts): string {
  const params = new URLSearchParams();
  if (typeof opts.limit === "number") params.set("limit", String(opts.limit));
  if (opts.cursor) params.set("cursor", opts.cursor);
  if (opts.search) params.set("search", opts.search);
  if (opts.item_type) params.set("item_type", opts.item_type);
  if (opts.project_type) params.set("project_type", opts.project_type);
  if (opts.workstation_group_uuid)
    params.set("workstation_group_uuid", opts.workstation_group_uuid);
  const s = params.toString();
  return s ? `?${s}` : "";
}

/**
 * Output-QC queue for the desktop /production/output-qc tab. Returns
 * one page of `received` manufactured lots awaiting pass / fail
 * verdict. Cursor-paginated; use `next_cursor` to fetch the next page.
 */
export async function getOutputQcQueue(
  opts: OutputQcQueueOpts = {},
): Promise<OutputQcQueueResponse | null> {
  const token = await getSessionToken();
  if (!token) return null;
  try {
    return await api<OutputQcQueueResponse>(
      `/api/production/output-qc${toQuery(opts)}`,
      { token, cache: "no-store" },
    );
  } catch {
    return null;
  }
}

