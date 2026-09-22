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
  | "cleaning_start"
  | "cleaning_end"
  | "maintenance_start"
  | "maintenance_end"
  | "equipment_cleaning_start"
  | "equipment_cleaning_end"
  | "equipment_maintenance_start"
  | "equipment_maintenance_end";

/** Set of triggers whose forms attach to an equipment CATEGORY on
 *  PSP (not a workstation). Equipment-scoped forms fire when an
 *  operator picks a specific machine on a cleaning / maintenance
 *  session — same audit split BRCGS auditors ask for.
 *
 *  Kept in sync with the Elixir side
 *  (`Backend.Forms.FormTemplate.@equipment_scoped_triggers`) — grep
 *  for `equipment_scoped_triggers` if you rename either. */
export const EQUIPMENT_SCOPED_TRIGGERS: ReadonlySet<FormTrigger> = new Set([
  "equipment_cleaning_start",
  "equipment_cleaning_end",
  "equipment_maintenance_start",
  "equipment_maintenance_end",
]);

export function isEquipmentScopedTrigger(t: FormTrigger): boolean {
  return EQUIPMENT_SCOPED_TRIGGERS.has(t);
}

/** Subset of triggers whose forms attach to a WORKSTATION (via
 *  `WorkstationFormAssignment`). Equipment-scoped triggers are
 *  excluded — those attach to equipment categories. Used by the
 *  workstation-attachment form picker so its Record can typecheck
 *  cleanly without needing to render pickers for the equipment
 *  triggers. */
export type WorkstationFormTrigger = Exclude<
  FormTrigger,
  | "equipment_cleaning_start"
  | "equipment_cleaning_end"
  | "equipment_maintenance_start"
  | "equipment_maintenance_end"
>;

/** Subset of triggers whose forms attach to an equipment CATEGORY.
 *  Every entry in `EQUIPMENT_SCOPED_TRIGGERS` narrowed at the type
 *  level. */
export type EquipmentFormTrigger = Extract<
  FormTrigger,
  | "equipment_cleaning_start"
  | "equipment_cleaning_end"
  | "equipment_maintenance_start"
  | "equipment_maintenance_end"
>;

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
  cleaning_start: "Cleaning (workstation) · start",
  cleaning_end: "Cleaning (workstation) · end",
  maintenance_start: "Maintenance (workstation) · start",
  maintenance_end: "Maintenance (workstation) · end",
  equipment_cleaning_start: "Cleaning (equipment) · start",
  equipment_cleaning_end: "Cleaning (equipment) · end",
  equipment_maintenance_start: "Maintenance (equipment) · start",
  equipment_maintenance_end: "Maintenance (equipment) · end",
};

export const TRIGGER_DESCRIPTIONS: Record<FormTrigger, string> = {
  workstation_start:
    "Fires on the kiosk when a worker starts a job on this workstation (before the timer begins).",
  workstation_end:
    "Fires on the kiosk when a worker ends their job on this workstation (before the timer stops).",
  cleaning_start:
    "Fires BEFORE the kiosk timer opens on a cleaning session (pre-cleaning PPE / setup checklist). Attach this form on the workstation.",
  cleaning_end:
    "Fires AFTER the operator taps Stop on a cleaning session (post-cleaning verification / signoff). Attach on the workstation. Per-equipment sections auto-generate at publish time (see the field group below).",
  maintenance_start:
    "Fires BEFORE the kiosk timer opens on a maintenance session. Attach on the workstation. Same authoring shape as the cleaning start.",
  maintenance_end:
    "Fires AFTER the operator taps Stop on a maintenance session. Attach on the workstation. Per-equipment sections auto-generate at publish time.",
  equipment_cleaning_start:
    "Fires BEFORE the kiosk timer opens when a worker scopes a cleaning session to a specific MACHINE. Attach on an equipment CATEGORY — every machine in that category inherits it.",
  equipment_cleaning_end:
    "Fires AFTER Stop when a worker scopes a cleaning session to a specific MACHINE (e.g. CIP the V-blender). Attach on an equipment CATEGORY — one checklist covers every V-blender in the plant.",
  equipment_maintenance_start:
    "Fires BEFORE the kiosk timer opens when a worker scopes a maintenance session to a specific MACHINE. Attach on an equipment CATEGORY.",
  equipment_maintenance_end:
    "Fires AFTER Stop when a worker scopes a maintenance session to a specific MACHINE. Attach on an equipment CATEGORY.",
};
