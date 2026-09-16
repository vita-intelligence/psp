import "server-only";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { HREmployeeLedgerPage } from "../hr/types";
import type { FormTemplate, FormTrigger } from "./types";

/** Slim option shape for the FormBuilder audience picker. Only
 *  employees whose `external_id` is set can be selected — the value
 *  stored on the form is the `external_id` (vita-perf `Worker.uuid`),
 *  which is what the publisher forwards and the kiosk enforces. */
export interface FormAudienceOption {
  external_id: string;
  full_name: string;
  preferred_name: string | null;
  is_active: boolean;
}

/**
 * Fetch every active HR employee with a populated `external_id` for
 * the audience picker. Uses a large `limit` because we render a
 * scrollable checkbox list rather than paginating — cheap for the
 * factory scale (dozens, not thousands).
 */
export async function listFormAudienceOptions(): Promise<FormAudienceOption[]> {
  const token = await getSessionToken();
  if (!token) return [];

  try {
    const page = await api<HREmployeeLedgerPage>(
      "/api/hr/employees?limit=500",
      { token, cache: "no-store" },
    );
    return page.items
      .filter((e) => e.is_active && !!e.external_id)
      .map((e) => ({
        external_id: e.external_id as string,
        full_name: e.full_name,
        preferred_name: e.preferred_name,
        is_active: e.is_active,
      }))
      .sort((a, b) => a.full_name.localeCompare(b.full_name));
  } catch {
    return [];
  }
}

export async function listFormTemplates(opts?: {
  includeInactive?: boolean;
  trigger?: FormTrigger;
}): Promise<FormTemplate[]> {
  const token = await getSessionToken();
  if (!token) return [];

  const qs = new URLSearchParams();
  if (opts?.includeInactive) qs.set("include_inactive", "true");
  if (opts?.trigger) qs.set("trigger", opts.trigger);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";

  try {
    const { items } = await api<{ items: FormTemplate[] }>(
      `/api/form-templates${suffix}`,
      { token, cache: "no-store" },
    );
    return items;
  } catch {
    return [];
  }
}

export async function getFormTemplate(
  uuid: string,
): Promise<FormTemplate | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    const { form_template } = await api<{ form_template: FormTemplate }>(
      `/api/form-templates/${encodeURIComponent(uuid)}`,
      { token, cache: "no-store" },
    );
    return form_template;
  } catch {
    return null;
  }
}

/** Workstations currently referencing this form template. Read-only —
 *  the FormBuilder shows this so an operator can see at a glance
 *  where the form will fire and click through to those workstation
 *  edit pages. Assignment itself happens on the workstation form. */
export interface FormAssignment {
  id: number;
  uuid: string;
  code: string | null;
  name: string;
  slot: "workstation_start" | "workstation_end" | "cleaning";
}

export async function listFormTemplateAssignments(
  uuid: string,
): Promise<FormAssignment[]> {
  const token = await getSessionToken();
  if (!token) return [];

  try {
    const { items } = await api<{ items: FormAssignment[] }>(
      `/api/form-templates/${encodeURIComponent(uuid)}/workstations`,
      { token, cache: "no-store" },
    );
    return items;
  } catch {
    return [];
  }
}
