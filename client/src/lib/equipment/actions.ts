"use server";

import { revalidatePath } from "next/cache";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import {
  toErrorResult,
  unauthorizedResult,
  type ErrorResult,
} from "../errors/server";
import type { Equipment } from "./types";

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
