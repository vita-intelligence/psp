/**
 * Form-template types shared between the PSP builder UI and the
 * vita-performance kiosk consumer. Field shape mirrors the
 * vita-performance schema on purpose — the publisher upserts a
 * flattened version of `FormTemplateSchema.fields` (+ resolved
 * per-equipment sections when trigger === "cleaning") into the
 * kiosk's `DynamicForm.schema` verbatim.
 */

export type FormTrigger =
  | "workstation_start"
  | "workstation_end"
  | "cleaning";

export type FormFieldType =
  | "text"
  | "number"
  | "yes_no"
  | "checkbox"
  | "dropdown"
  | "rating"
  | "signature"
  | "qc_approval"
  | "task_select"
  // "acknowledgement" is a single-tick attestation ("I confirm I
  // know how to operate this station"). Renders as one checkbox
  // with the field label; kiosk blocks Submit until it's ticked.
  | "acknowledgement"
  // "header" is a PSP-only, kiosk-render-only field type — it renders
  // as a section title with no input. Used at publish time to insert
  // an equipment section header between blocks of per-equipment fields.
  | "header";

export interface FormFieldOption {
  id: string;
  label: string;
  target_quantity?: number;
  target_duration?: number;
}

export interface FormField {
  id: string;
  type: FormFieldType;
  label: string;
  required: boolean;
  placeholder?: string;
  options?: FormFieldOption[];
  max_rating?: number;
  condition?: {
    field_id: string;
    operator: "equals" | "not_equals";
    value: string;
  } | null;
}

export interface FormTemplateSchema {
  fields: FormField[];
  /** Cleaning-only template — replicated once per attached
   *  equipment at publish time. Null for start/end triggers. */
  per_equipment_fields: FormField[] | null;
}

export interface FormTemplate {
  id: number;
  uuid: string;
  name: string;
  description: string | null;
  trigger: FormTrigger;
  schema: FormTemplateSchema;
  version: number;
  last_published_at: string | null;
  last_published_version: number | null;
  dirty_since_publish: boolean;
  is_active: boolean;
  /** Optional allowlist of vita-perf `Worker.uuid` values (produced
   *  by the FormBuilder picker off `Employee.external_id`). Empty
   *  array = everyone on the assigned workstation; non-empty = kiosk
   *  audience-gates on the current worker's uuid. */
  worker_uuids: string[];
  created_by: { id: number; name: string | null } | null;
  updated_by: { id: number; name: string | null } | null;
  inserted_at: string;
  updated_at: string;
}

/** Slim shape for the workstation-assignment picker. */
export interface FormTemplateSummary {
  id: number;
  uuid: string;
  name: string;
  trigger: FormTrigger;
  is_active: boolean;
}

export const TRIGGER_LABELS: Record<FormTrigger, string> = {
  workstation_start: "Workstation start",
  workstation_end: "Workstation end",
  cleaning: "Cleaning",
};

export const TRIGGER_DESCRIPTIONS: Record<FormTrigger, string> = {
  workstation_start:
    "Fires on the kiosk when a worker starts a job on this workstation (before the timer begins).",
  workstation_end:
    "Fires on the kiosk when a worker ends their job on this workstation (before the timer stops).",
  cleaning:
    "Fires on the kiosk when a worker taps the Cleaning icon and picks this workstation. Attached-equipment sections auto-generate at publish time.",
};
