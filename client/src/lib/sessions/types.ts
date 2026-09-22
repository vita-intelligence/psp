import type { FormTrigger, FormTemplateSchema } from "../forms/types";

export type ActivityKind = "mo" | "cleaning" | "maintenance" | "other";

export interface SubmissionSessionRef {
  id: number;
  uuid: string;
  activity_kind: ActivityKind;
  started_at: string | null;
  finished_at: string | null;
  manufacturing_order_step_id: number | null;
}

export interface SubmissionWorkstationRef {
  id: number;
  uuid: string;
  name: string;
}

export interface SubmissionEquipmentRef {
  id: number;
  uuid: string;
  serial_number: string | null;
}

export interface SubmissionSubmitterRef {
  id: number | null;
  name: string | null;
  worker_uuid: string | null;
}

export interface FormSubmissionRow {
  uuid: string;
  form_name: string;
  form_trigger: FormTrigger;
  form_template_uuid: string;
  workstation: SubmissionWorkstationRef | null;
  workstation_uuid: string;
  equipment: SubmissionEquipmentRef | null;
  equipment_uuid: string | null;
  activity_kind: ActivityKind | null;
  submitted_by: SubmissionSubmitterRef;
  submitted_at: string;
  answer_count: number;
  session: SubmissionSessionRef | null;
}

export interface FormSubmissionDetail extends FormSubmissionRow {
  schema_snapshot: FormTemplateSchema;
  schema_version: number | null;
  answers: Record<string, unknown>;
  inserted_at: string;
}

/** Cursor-paginated shape returned by the FE + backend list APIs. */
export interface FormSubmissionPage {
  items: FormSubmissionRow[];
  next_cursor: string | null;
  limit: number;
}

export interface SubmissionFilters {
  workstation_uuid?: string;
  equipment_uuid?: string;
  form_template_uuid?: string;
  workstation_session_uuid?: string;
  submitted_by_id?: string;
  submitted_by_uuid?: string;
  trigger?: FormTrigger;
  activity_kind?: ActivityKind;
  from?: string;
  to?: string;
  search?: string;
  cursor?: string;
  limit?: number;
}

/** Facet-picker option shape shared by all four lookup types. */
export interface SubmissionLookupItem {
  key: string;
  uuid: string | null;
  label: string;
  sublabel: string | null;
}

export const ACTIVITY_KIND_LABELS: Record<ActivityKind, string> = {
  mo: "Manufacturing order",
  cleaning: "Cleaning",
  maintenance: "Maintenance",
  other: "Other",
};

export const SUBMISSION_LOOKUP_TYPES = [
  "workstation",
  "equipment",
  "form",
  "submitter",
] as const;

export type SubmissionLookupType = (typeof SUBMISSION_LOOKUP_TYPES)[number];
