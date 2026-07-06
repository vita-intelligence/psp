import "server-only";
import { api, ApiError } from "../api";
import { getSessionToken } from "../auth/server";
import type { MyTasksPage } from "./types";

interface ListOpts {
  limit?: number;
  cursor?: string | null;
  phase?: string | null;
  urgency?: string | null;
  search?: string | null;
}

const EMPTY: MyTasksPage = { tasks: [], next_cursor: null };

/** Fetch a page of the actor's tasks. Falls back to an empty page on
 *  unauthorised / server errors so the /my-tasks route can render an
 *  empty state without crashing. */
export async function listMyTasks(opts: ListOpts = {}): Promise<MyTasksPage> {
  const token = await getSessionToken();
  if (!token) return EMPTY;

  const qs = new URLSearchParams();
  if (opts.limit) qs.set("limit", String(opts.limit));
  if (opts.cursor) qs.set("cursor", opts.cursor);
  if (opts.phase) qs.set("phase", opts.phase);
  if (opts.urgency) qs.set("urgency", opts.urgency);
  if (opts.search) qs.set("search", opts.search);

  const path = qs.toString().length ? `/api/my-tasks?${qs}` : "/api/my-tasks";

  try {
    return await api<MyTasksPage>(path, { token });
  } catch (err) {
    if (err instanceof ApiError) return EMPTY;
    throw err;
  }
}
