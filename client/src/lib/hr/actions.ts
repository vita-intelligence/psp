"use server";

import { revalidatePath } from "next/cache";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import {
  toErrorResult,
  unauthorizedResult,
  type ErrorResult,
} from "../errors/server";
import type {
  HREmployee,
  HREmployeeReputationEvent,
  HREmployeeReputationEventInput,
  HREmployeeUpsertInput,
  HREmployeeWage,
  HREmployeeWageInput,
} from "./types";

export type HREmployeeResult =
  | { ok: true; employee: HREmployee }
  | ErrorResult;

export type HRWageResult =
  | { ok: true; wage: HREmployeeWage; employee: HREmployee }
  | ErrorResult;

export type HRReputationResult =
  | {
      ok: true;
      event: HREmployeeReputationEvent;
      employee: HREmployee;
    }
  | ErrorResult;

export async function createHREmployeeAction(
  attrs: HREmployeeUpsertInput,
): Promise<HREmployeeResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("createHREmployeeAction");
  try {
    const { employee } = await api<{ employee: HREmployee }>(
      "/api/hr/employees",
      { method: "POST", token, body: JSON.stringify(attrs) },
    );
    revalidatePath("/hr");
    return { ok: true, employee };
  } catch (err) {
    return toErrorResult(err, {
      source: "createHREmployeeAction",
      fallbackDetail: "Couldn't create the employee.",
    });
  }
}

export async function updateHREmployeeAction(
  uuid: string,
  attrs: HREmployeeUpsertInput,
): Promise<HREmployeeResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("updateHREmployeeAction");
  try {
    const { employee } = await api<{ employee: HREmployee }>(
      `/api/hr/employees/${encodeURIComponent(uuid)}`,
      { method: "PATCH", token, body: JSON.stringify(attrs) },
    );
    revalidatePath("/hr");
    revalidatePath(`/hr/employees/${uuid}`);
    return { ok: true, employee };
  } catch (err) {
    return toErrorResult(err, {
      source: "updateHREmployeeAction",
      fallbackDetail: "Couldn't save the employee.",
    });
  }
}

/** Soft-archive (is_active=false + termination_date stamp). Sessions
 *  FK the row so we never hard-delete. */
export async function archiveHREmployeeAction(
  uuid: string,
  terminationDate?: string,
): Promise<HREmployeeResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("archiveHREmployeeAction");
  try {
    const body = terminationDate
      ? JSON.stringify({ termination_date: terminationDate })
      : "{}";
    const { employee } = await api<{ employee: HREmployee }>(
      `/api/hr/employees/${encodeURIComponent(uuid)}/archive`,
      { method: "POST", token, body },
    );
    revalidatePath("/hr");
    revalidatePath(`/hr/employees/${uuid}`);
    return { ok: true, employee };
  } catch (err) {
    return toErrorResult(err, {
      source: "archiveHREmployeeAction",
      fallbackDetail: "Couldn't archive the employee.",
    });
  }
}

export async function addWageAction(
  employeeUuid: string,
  attrs: HREmployeeWageInput,
): Promise<HRWageResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("addWageAction");
  try {
    const { wage, employee } = await api<{
      wage: HREmployeeWage;
      employee: HREmployee;
    }>(`/api/hr/employees/${encodeURIComponent(employeeUuid)}/wages`, {
      method: "POST",
      token,
      body: JSON.stringify(attrs),
    });
    revalidatePath(`/hr/employees/${employeeUuid}`);
    return { ok: true, wage, employee };
  } catch (err) {
    return toErrorResult(err, {
      source: "addWageAction",
      fallbackDetail: "Couldn't record the wage change.",
    });
  }
}

export async function recordReputationEventAction(
  employeeUuid: string,
  attrs: HREmployeeReputationEventInput,
): Promise<HRReputationResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("recordReputationEventAction");
  try {
    const { event, employee } = await api<{
      event: HREmployeeReputationEvent;
      employee: HREmployee;
    }>(
      `/api/hr/employees/${encodeURIComponent(employeeUuid)}/reputation-events`,
      { method: "POST", token, body: JSON.stringify(attrs) },
    );
    revalidatePath(`/hr/employees/${employeeUuid}`);
    return { ok: true, event, employee };
  } catch (err) {
    return toErrorResult(err, {
      source: "recordReputationEventAction",
      fallbackDetail: "Couldn't record the reputation event.",
    });
  }
}
