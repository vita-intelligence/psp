"use server";

import { revalidatePath } from "next/cache";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import { getDeviceToken } from "../devices/server";
import {
  toErrorResult,
  unauthorizedResult,
  type ErrorResult,
} from "../errors/server";
import type {
  Equipment,
  EquipmentCategory,
  EquipmentFile,
  EquipmentFileKind,
  EquipmentMaintenanceTask,
  EquipmentRepair,
  EquipmentRepairPart,
  EquipmentRunningCostComponent,
  MaintenancePeriodicity,
  MaintenanceTaskType,
} from "./types";

export interface CreateEquipmentInput {
  item_id: number;
  category_id?: number | null;
  workstation_id?: number | null;
  serial_number: string;
  manufacturer_serial?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  unit_cost?: string | null;
  currency?: string | null;
  acquired_at?: string | null;
  warranty_end_at?: string | null;
  useful_life_years?: number | null;
  calibration_frequency_months?: number | null;
  maintenance_frequency_months?: number | null;
  current_cell_id?: number | null;
  assigned_to_id?: number | null;
  purchase_order_line_id?: number | null;
  notes?: string | null;
}

export type CreateEquipmentResult =
  | { ok: true; equipment: Equipment }
  | ErrorResult;

export async function createEquipmentAction(
  input: CreateEquipmentInput,
): Promise<CreateEquipmentResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("createEquipmentAction");

  try {
    const { equipment } = await api<{ equipment: Equipment }>(
      "/api/equipment",
      { method: "POST", token, body: JSON.stringify(input) },
    );
    revalidatePath("/equipment");
    return { ok: true, equipment };
  } catch (err) {
    return toErrorResult(err, {
      source: "createEquipmentAction",
      fallbackDetail: "Couldn't create equipment.",
    });
  }
}

export interface MoveEquipmentInput {
  /** Target cell UUID. Pass null (or omit) to clear the cell — the
   *  operator can accompany that with `location_description` for
   *  office kit that doesn't live in a cell. */
  to_cell_uuid?: string | null;
  /** Free-text "where is it" for units off the storage floor. */
  location_description?: string | null;
  /** Optional audit note that lands on the timeline event. */
  reason?: string | null;
}

export async function moveEquipmentAction(
  uuid: string,
  input: MoveEquipmentInput,
): Promise<{ ok: true; equipment: Equipment } | ErrorResult> {
  // Accept either the laptop session or a paired device token — the
  // mobile scan flow drives moves too, and phones auth via the
  // device cookie.
  const token =
    (await getSessionToken()) ?? (await getDeviceToken());
  if (!token) return unauthorizedResult("moveEquipmentAction");

  try {
    const { equipment } = await api<{ equipment: Equipment }>(
      `/api/equipment/${encodeURIComponent(uuid)}/move`,
      { method: "POST", token, body: JSON.stringify(input) },
    );
    revalidatePath("/equipment");
    revalidatePath(`/equipment/${uuid}`);
    return { ok: true, equipment };
  } catch (err) {
    return toErrorResult(err, {
      source: "moveEquipmentAction",
      fallbackDetail: "Couldn't record the move.",
    });
  }
}

export interface RecordEquipmentEventInput {
  kind: string;
  reason?: string | null;
  to_cell_id?: number | null;
  from_cell_id?: number | null;
  assigned_to_user_id?: number | null;
  metadata?: Record<string, unknown>;
}

export type RecordEquipmentEventResult =
  | { ok: true; equipment: Equipment }
  | ErrorResult;

export async function recordEquipmentEventAction(
  uuid: string,
  input: RecordEquipmentEventInput,
): Promise<RecordEquipmentEventResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("recordEquipmentEventAction");

  try {
    const { equipment } = await api<{ equipment: Equipment }>(
      `/api/equipment/${encodeURIComponent(uuid)}/events`,
      { method: "POST", token, body: JSON.stringify(input) },
    );
    revalidatePath("/equipment");
    revalidatePath(`/equipment/${uuid}`);
    return { ok: true, equipment };
  } catch (err) {
    return toErrorResult(err, {
      source: "recordEquipmentEventAction",
      fallbackDetail: "Couldn't record the event.",
    });
  }
}

/** Multipart upload of a file against an equipment unit — cal cert,
 *  service report, warranty PDF, photo. Bytes stream via
 *  Backend.Storage; the returned uuid is how the BE references it. */
export async function uploadEquipmentFileAction(
  equipmentUuid: string,
  kind: EquipmentFileKind,
  file: File,
): Promise<{ ok: true; file: EquipmentFile } | ErrorResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("uploadEquipmentFileAction");

  const form = new FormData();
  form.append("file", file);
  form.append("kind", kind);

  try {
    const res = await api<{ file: EquipmentFile }>(
      `/api/equipment/${encodeURIComponent(equipmentUuid)}/files`,
      { method: "POST", token, body: form },
    );
    revalidatePath(`/equipment/${equipmentUuid}`);
    return { ok: true, file: res.file };
  } catch (err) {
    return toErrorResult(err, {
      source: "uploadEquipmentFileAction",
      fallbackDetail: "Couldn't upload the file.",
    });
  }
}

export async function deleteEquipmentFileAction(
  equipmentUuid: string,
  fileUuid: string,
): Promise<{ ok: true } | ErrorResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("deleteEquipmentFileAction");

  try {
    await api<null>(
      `/api/equipment/${encodeURIComponent(equipmentUuid)}/files/${encodeURIComponent(fileUuid)}`,
      { method: "DELETE", token },
    );
    revalidatePath(`/equipment/${equipmentUuid}`);
    return { ok: true };
  } catch (err) {
    return toErrorResult(err, {
      source: "deleteEquipmentFileAction",
      fallbackDetail: "Couldn't delete the file.",
    });
  }
}

// ═══════════════════════════════════════════════════════════════════
// Maintenance tasks
// ═══════════════════════════════════════════════════════════════════

export interface CreateMaintenanceTaskInput {
  task_name: string;
  task_type: MaintenanceTaskType;
  periodicity?: MaintenancePeriodicity | null;
  periodicity_interval?: number | null;
  assigned_to_user_id?: number | null;
  start_date?: string | null;
  end_date?: string | null;
  next_due_date?: string | null;
  certificate_required?: boolean;
  notes?: string | null;
}

export type MaintenanceTaskResult =
  | { ok: true; task: EquipmentMaintenanceTask }
  | ErrorResult;

export async function createMaintenanceTaskAction(
  equipmentUuid: string,
  input: CreateMaintenanceTaskInput,
): Promise<MaintenanceTaskResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("createMaintenanceTaskAction");

  try {
    const { task } = await api<{ task: EquipmentMaintenanceTask }>(
      `/api/equipment/${encodeURIComponent(equipmentUuid)}/maintenance-tasks`,
      { method: "POST", token, body: JSON.stringify(input) },
    );
    revalidatePath(`/equipment/${equipmentUuid}`);
    return { ok: true, task };
  } catch (err) {
    return toErrorResult(err, {
      source: "createMaintenanceTaskAction",
      fallbackDetail: "Couldn't create the maintenance task.",
    });
  }
}

export async function updateMaintenanceTaskAction(
  equipmentUuid: string,
  taskUuid: string,
  input: Partial<CreateMaintenanceTaskInput>,
): Promise<MaintenanceTaskResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("updateMaintenanceTaskAction");

  try {
    const { task } = await api<{ task: EquipmentMaintenanceTask }>(
      `/api/equipment/${encodeURIComponent(equipmentUuid)}/maintenance-tasks/${encodeURIComponent(taskUuid)}`,
      { method: "PATCH", token, body: JSON.stringify(input) },
    );
    revalidatePath(`/equipment/${equipmentUuid}`);
    return { ok: true, task };
  } catch (err) {
    return toErrorResult(err, {
      source: "updateMaintenanceTaskAction",
      fallbackDetail: "Couldn't update the task.",
    });
  }
}

export async function deleteMaintenanceTaskAction(
  equipmentUuid: string,
  taskUuid: string,
): Promise<MaintenanceTaskResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("deleteMaintenanceTaskAction");

  try {
    const { task } = await api<{ task: EquipmentMaintenanceTask }>(
      `/api/equipment/${encodeURIComponent(equipmentUuid)}/maintenance-tasks/${encodeURIComponent(taskUuid)}`,
      { method: "DELETE", token },
    );
    revalidatePath(`/equipment/${equipmentUuid}`);
    return { ok: true, task };
  } catch (err) {
    return toErrorResult(err, {
      source: "deleteMaintenanceTaskAction",
      fallbackDetail: "Couldn't archive the task.",
    });
  }
}

export interface CompleteMaintenanceTaskInput {
  completed_on?: string;
  reason?: string;
  evidence_urls?: string[];
}

export async function completeMaintenanceTaskAction(
  equipmentUuid: string,
  taskUuid: string,
  input: CompleteMaintenanceTaskInput,
): Promise<MaintenanceTaskResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("completeMaintenanceTaskAction");

  try {
    const { task } = await api<{ task: EquipmentMaintenanceTask }>(
      `/api/equipment/${encodeURIComponent(equipmentUuid)}/maintenance-tasks/${encodeURIComponent(taskUuid)}/complete`,
      { method: "POST", token, body: JSON.stringify(input) },
    );
    revalidatePath(`/equipment/${equipmentUuid}`);
    return { ok: true, task };
  } catch (err) {
    return toErrorResult(err, {
      source: "completeMaintenanceTaskAction",
      fallbackDetail: "Couldn't record the completion.",
    });
  }
}

// ═══════════════════════════════════════════════════════════════════
// Repairs
// ═══════════════════════════════════════════════════════════════════

export interface ReportRepairInput {
  failure_date: string;
  description?: string | null;
  assigned_to_user_id?: number | null;
  external_vendor_name?: string | null;
  notes?: string | null;
}

export type RepairResult = { ok: true; repair: EquipmentRepair } | ErrorResult;

export async function reportRepairAction(
  equipmentUuid: string,
  input: ReportRepairInput,
): Promise<RepairResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("reportRepairAction");

  try {
    const { repair } = await api<{ repair: EquipmentRepair }>(
      `/api/equipment/${encodeURIComponent(equipmentUuid)}/repairs`,
      { method: "POST", token, body: JSON.stringify(input) },
    );
    revalidatePath(`/equipment/${equipmentUuid}`);
    return { ok: true, repair };
  } catch (err) {
    return toErrorResult(err, {
      source: "reportRepairAction",
      fallbackDetail: "Couldn't record the breakdown.",
    });
  }
}

export interface UpdateRepairInput {
  started_at?: string | null;
  status?: string;
  description?: string | null;
  actions_performed?: string | null;
  repair_cost?: string | null;
  currency?: string | null;
  assigned_to_user_id?: number | null;
  external_vendor_name?: string | null;
  notes?: string | null;
}

export async function updateRepairAction(
  equipmentUuid: string,
  repairUuid: string,
  input: UpdateRepairInput,
): Promise<RepairResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("updateRepairAction");

  try {
    const { repair } = await api<{ repair: EquipmentRepair }>(
      `/api/equipment/${encodeURIComponent(equipmentUuid)}/repairs/${encodeURIComponent(repairUuid)}`,
      { method: "PATCH", token, body: JSON.stringify(input) },
    );
    revalidatePath(`/equipment/${equipmentUuid}`);
    return { ok: true, repair };
  } catch (err) {
    return toErrorResult(err, {
      source: "updateRepairAction",
      fallbackDetail: "Couldn't update the repair.",
    });
  }
}

export interface CompleteRepairInput {
  completion_date?: string;
  actions_performed?: string;
  repair_cost?: string | null;
  currency?: string | null;
}

export async function completeRepairAction(
  equipmentUuid: string,
  repairUuid: string,
  input: CompleteRepairInput,
): Promise<RepairResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("completeRepairAction");

  try {
    const { repair } = await api<{ repair: EquipmentRepair }>(
      `/api/equipment/${encodeURIComponent(equipmentUuid)}/repairs/${encodeURIComponent(repairUuid)}/complete`,
      { method: "POST", token, body: JSON.stringify(input) },
    );
    revalidatePath(`/equipment/${equipmentUuid}`);
    return { ok: true, repair };
  } catch (err) {
    return toErrorResult(err, {
      source: "completeRepairAction",
      fallbackDetail: "Couldn't complete the repair.",
    });
  }
}

export interface AddRepairPartInput {
  item_id: number;
  quantity: string;
  unit_cost?: string | null;
  currency?: string | null;
  notes?: string | null;
}

export async function addRepairPartAction(
  equipmentUuid: string,
  repairUuid: string,
  input: AddRepairPartInput,
): Promise<{ ok: true; part: EquipmentRepairPart } | ErrorResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("addRepairPartAction");

  try {
    const { part } = await api<{ part: EquipmentRepairPart }>(
      `/api/equipment/${encodeURIComponent(equipmentUuid)}/repairs/${encodeURIComponent(repairUuid)}/parts`,
      { method: "POST", token, body: JSON.stringify(input) },
    );
    revalidatePath(`/equipment/${equipmentUuid}`);
    return { ok: true, part };
  } catch (err) {
    return toErrorResult(err, {
      source: "addRepairPartAction",
      fallbackDetail: "Couldn't add the part.",
    });
  }
}

export async function removeRepairPartAction(
  equipmentUuid: string,
  repairUuid: string,
  partUuid: string,
): Promise<{ ok: true } | ErrorResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("removeRepairPartAction");

  try {
    await api<null>(
      `/api/equipment/${encodeURIComponent(equipmentUuid)}/repairs/${encodeURIComponent(repairUuid)}/parts/${encodeURIComponent(partUuid)}`,
      { method: "DELETE", token },
    );
    revalidatePath(`/equipment/${equipmentUuid}`);
    return { ok: true };
  } catch (err) {
    return toErrorResult(err, {
      source: "removeRepairPartAction",
      fallbackDetail: "Couldn't remove the part.",
    });
  }
}

// ═══════════════════════════════════════════════════════════════════
// Running-cost components (electricity, air, maintenance reserve, …)
// ═══════════════════════════════════════════════════════════════════

export interface RunningCostComponentInput {
  label: string;
  amount_per_hour: string;
  currency?: string | null;
  notes?: string | null;
}

export type RunningCostComponentResult =
  | { ok: true; component: EquipmentRunningCostComponent }
  | ErrorResult;

export async function createRunningCostComponentAction(
  equipmentUuid: string,
  input: RunningCostComponentInput,
): Promise<RunningCostComponentResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("createRunningCostComponentAction");

  try {
    const { component } = await api<{
      component: EquipmentRunningCostComponent;
    }>(
      `/api/equipment/${encodeURIComponent(equipmentUuid)}/running-costs`,
      { method: "POST", token, body: JSON.stringify(input) },
    );
    revalidatePath(`/equipment/${equipmentUuid}`);
    return { ok: true, component };
  } catch (err) {
    return toErrorResult(err, {
      source: "createRunningCostComponentAction",
      fallbackDetail: "Couldn't add the cost line.",
    });
  }
}

export async function updateRunningCostComponentAction(
  equipmentUuid: string,
  componentUuid: string,
  input: Partial<RunningCostComponentInput> & { is_active?: boolean },
): Promise<RunningCostComponentResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("updateRunningCostComponentAction");

  try {
    const { component } = await api<{
      component: EquipmentRunningCostComponent;
    }>(
      `/api/equipment/${encodeURIComponent(equipmentUuid)}/running-costs/${encodeURIComponent(componentUuid)}`,
      { method: "PATCH", token, body: JSON.stringify(input) },
    );
    revalidatePath(`/equipment/${equipmentUuid}`);
    return { ok: true, component };
  } catch (err) {
    return toErrorResult(err, {
      source: "updateRunningCostComponentAction",
      fallbackDetail: "Couldn't save the cost line.",
    });
  }
}

export async function deleteRunningCostComponentAction(
  equipmentUuid: string,
  componentUuid: string,
): Promise<RunningCostComponentResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("deleteRunningCostComponentAction");

  try {
    const { component } = await api<{
      component: EquipmentRunningCostComponent;
    }>(
      `/api/equipment/${encodeURIComponent(equipmentUuid)}/running-costs/${encodeURIComponent(componentUuid)}`,
      { method: "DELETE", token },
    );
    revalidatePath(`/equipment/${equipmentUuid}`);
    return { ok: true, component };
  } catch (err) {
    return toErrorResult(err, {
      source: "deleteRunningCostComponentAction",
      fallbackDetail: "Couldn't archive the cost line.",
    });
  }
}

// ═══════════════════════════════════════════════════════════════════
// Categories
// ═══════════════════════════════════════════════════════════════════

export interface CategoryInput {
  name: string;
  notes?: string | null;
  default_useful_life_years?: number | null;
  default_calibration_frequency_months?: number | null;
  default_maintenance_frequency_months?: number | null;
  is_active?: boolean;
}

export type CategoryResult =
  | { ok: true; category: EquipmentCategory }
  | ErrorResult;

export async function createEquipmentCategoryAction(
  input: CategoryInput,
): Promise<CategoryResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("createEquipmentCategoryAction");

  try {
    const { category } = await api<{ category: EquipmentCategory }>(
      "/api/equipment-categories",
      { method: "POST", token, body: JSON.stringify(input) },
    );
    revalidatePath("/settings/equipment-categories");
    revalidatePath("/equipment/new");
    return { ok: true, category };
  } catch (err) {
    return toErrorResult(err, {
      source: "createEquipmentCategoryAction",
      fallbackDetail: "Couldn't create the category.",
    });
  }
}

export async function updateEquipmentCategoryAction(
  uuid: string,
  input: Partial<CategoryInput>,
): Promise<CategoryResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("updateEquipmentCategoryAction");

  try {
    const { category } = await api<{ category: EquipmentCategory }>(
      `/api/equipment-categories/${encodeURIComponent(uuid)}`,
      { method: "PATCH", token, body: JSON.stringify(input) },
    );
    revalidatePath("/settings/equipment-categories");
    revalidatePath("/equipment/new");
    return { ok: true, category };
  } catch (err) {
    return toErrorResult(err, {
      source: "updateEquipmentCategoryAction",
      fallbackDetail: "Couldn't update the category.",
    });
  }
}

/** Result shape from replacing form assignments on one category. */
export type CategoryFormAssignmentsResult =
  | {
      ok: true;
      items: Array<{
        uuid: string;
        slot: "equipment_cleaning" | "equipment_maintenance";
        sort_order: number;
        form_template: {
          uuid: string;
          name: string;
          trigger: string;
          version: number;
          is_active: boolean;
        } | null;
      }>;
    }
  | ErrorResult;

/** Bulk-overwrite the form assignments on one equipment category.
 *  Missing rows = detached. Server-side revalidates the settings
 *  category page + broadcasts to every workstation carrying a
 *  machine in this category so their kiosks pick up the change. */
export async function replaceCategoryFormAssignmentsAction(
  categoryUuid: string,
  input: Array<{
    form_template_uuid: string;
    slot: "equipment_cleaning" | "equipment_maintenance";
    sort_order?: number;
  }>,
): Promise<CategoryFormAssignmentsResult> {
  const token = await getSessionToken();
  if (!token) {
    return unauthorizedResult("replaceCategoryFormAssignmentsAction");
  }

  try {
    const res = await api<CategoryFormAssignmentsResult & { ok?: true }>(
      `/api/equipment-categories/${encodeURIComponent(categoryUuid)}/form-assignments`,
      {
        method: "PUT",
        token,
        body: JSON.stringify({ assignments: input }),
      },
    );
    revalidatePath(
      `/settings/equipment-categories/${encodeURIComponent(categoryUuid)}`,
    );
    revalidatePath("/settings/equipment-categories");
    return { ok: true, items: (res as { items: unknown[] }).items as never };
  } catch (err) {
    return toErrorResult(err, {
      source: "replaceCategoryFormAssignmentsAction",
      fallbackDetail: "Couldn't save the form assignments.",
    });
  }
}

export async function deleteEquipmentCategoryAction(
  uuid: string,
): Promise<CategoryResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("deleteEquipmentCategoryAction");

  try {
    const { category } = await api<{ category: EquipmentCategory }>(
      `/api/equipment-categories/${encodeURIComponent(uuid)}`,
      { method: "DELETE", token },
    );
    revalidatePath("/settings/equipment-categories");
    revalidatePath("/equipment/new");
    return { ok: true, category };
  } catch (err) {
    return toErrorResult(err, {
      source: "deleteEquipmentCategoryAction",
      fallbackDetail: "Couldn't archive the category.",
    });
  }
}
