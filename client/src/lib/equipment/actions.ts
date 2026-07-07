"use server";

import { revalidatePath } from "next/cache";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import {
  toErrorResult,
  unauthorizedResult,
  type ErrorResult,
} from "../errors/server";
import type { Equipment, EquipmentFile, EquipmentFileKind } from "./types";

export interface CreateEquipmentInput {
  item_id: number;
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
