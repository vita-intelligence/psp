"use server";

import { revalidatePath } from "next/cache";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type {
  Allergen,
  RawMaterialCompliance,
  RawMaterialRisk,
} from "../types";
import {
  toErrorResult,
  unauthorizedResult,
  type ErrorResult,
} from "../errors/server";

export type ComplianceResult =
  | { ok: true; compliance: RawMaterialCompliance }
  | ErrorResult;

export type RiskResult =
  | { ok: true; risk: RawMaterialRisk }
  | ErrorResult;

export type AllergensResult =
  | { ok: true; allergens: Allergen[] }
  | ErrorResult;

export async function upsertComplianceAction(
  itemUuid: string,
  input: Partial<RawMaterialCompliance>,
): Promise<ComplianceResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("upsertComplianceAction");

  try {
    const res = await api<{ compliance: RawMaterialCompliance }>(
      `/api/items/${itemUuid}/raw-material-compliance`,
      { method: "PUT", token, body: JSON.stringify(input) },
    );
    revalidatePath(`/production/items/${itemUuid}`);
    return { ok: true, compliance: res.compliance };
  } catch (err) {
    return toErrorResult(err, {
      source: "upsertComplianceAction",
      fallbackDetail: "Couldn't save the compliance section.",
    });
  }
}

export async function upsertRiskAction(
  itemUuid: string,
  input: Partial<RawMaterialRisk>,
): Promise<RiskResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("upsertRiskAction");

  try {
    const res = await api<{ risk: RawMaterialRisk }>(
      `/api/items/${itemUuid}/raw-material-risk`,
      { method: "PUT", token, body: JSON.stringify(input) },
    );
    revalidatePath(`/production/items/${itemUuid}`);
    return { ok: true, risk: res.risk };
  } catch (err) {
    return toErrorResult(err, {
      source: "upsertRiskAction",
      fallbackDetail: "Couldn't save the risk assessment.",
    });
  }
}

export async function setAllergensAction(
  itemUuid: string,
  allergen_uuids: string[],
): Promise<AllergensResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("setAllergensAction");

  try {
    const res = await api<{ allergens: Allergen[] }>(
      `/api/items/${itemUuid}/allergens`,
      {
        method: "PUT",
        token,
        body: JSON.stringify({ allergen_uuids }),
      },
    );
    revalidatePath(`/production/items/${itemUuid}`);
    return { ok: true, allergens: res.allergens };
  } catch (err) {
    return toErrorResult(err, {
      source: "setAllergensAction",
      fallbackDetail: "Couldn't update the allergen list.",
    });
  }
}
