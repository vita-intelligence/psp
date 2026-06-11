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
  Inspection,
  InspectionDeliveryInfoPatch,
  InspectionFile,
  InspectionItem,
  InspectionItemUpsertInput,
  InspectionSectionPatch,
  QualityDecision,
} from "./types";

/**
 * Server actions for the goods-in mobile wizard.
 *
 * Token resolution: try the device bearer first (so the dock tablet's
 * paired session is used when present), fall back to the laptop
 * session bearer (QC team approving from their desk).
 */

async function activeToken(): Promise<string | null> {
  return (await getDeviceToken()) ?? (await getSessionToken());
}

export type InspectionResult =
  | { ok: true; inspection: Inspection }
  | ErrorResult;

export type InspectionItemResult =
  | { ok: true; item: InspectionItem }
  | ErrorResult;

export type InspectionFileResult =
  | { ok: true; file: InspectionFile }
  | ErrorResult;

export type DeleteResult = { ok: true } | ErrorResult;

function revalidateInspection(uuid: string) {
  revalidatePath(`/m/inspections/${uuid}`);
}

/** Section-1 + identity at draft creation. Server requires a delivery
 *  date at minimum; everything else can be filled later via PATCH. */
export interface CreateDraftInput {
  delivery_date: string;
  delivery_time?: string | null;
  transport_company?: string | null;
  vehicle_registration?: string | null;
  seal_number?: string | null;
}

export async function createDraftAction(
  poUuid: string,
  attrs: CreateDraftInput,
): Promise<InspectionResult> {
  const token = await activeToken();
  if (!token) return unauthorizedResult("createDraftAction");
  try {
    const res = await api<{ goods_in_inspection: Inspection }>(
      `/api/purchase-orders/${encodeURIComponent(poUuid)}/goods-in-inspections`,
      { method: "POST", token, body: JSON.stringify(attrs) },
    );
    return { ok: true, inspection: res.goods_in_inspection };
  } catch (err) {
    return toErrorResult(err, {
      source: "createDraftAction",
      fallbackDetail: "Couldn't create the inspection draft.",
    });
  }
}

/**
 * Two-way: either patch the delivery-info columns (section 1) OR
 * patch a section JSONB. The backend's `update_dispatch/2` checks
 * for `section + value` and routes accordingly.
 */
export async function updateInspectionAction(
  uuid: string,
  attrs: InspectionDeliveryInfoPatch | InspectionSectionPatch,
): Promise<InspectionResult> {
  const token = await activeToken();
  if (!token) return unauthorizedResult("updateInspectionAction");
  try {
    const res = await api<{ goods_in_inspection: Inspection }>(
      `/api/goods-in-inspections/${encodeURIComponent(uuid)}`,
      { method: "PATCH", token, body: JSON.stringify(attrs) },
    );
    revalidateInspection(uuid);
    return { ok: true, inspection: res.goods_in_inspection };
  } catch (err) {
    return toErrorResult(err, {
      source: "updateInspectionAction",
      fallbackDetail: "Couldn't save this step.",
    });
  }
}

export async function upsertItemAction(
  inspectionUuid: string,
  lineUuid: string,
  attrs: InspectionItemUpsertInput,
): Promise<InspectionItemResult> {
  const token = await activeToken();
  if (!token) return unauthorizedResult("upsertItemAction");
  try {
    const res = await api<{ inspection_item: InspectionItem }>(
      `/api/goods-in-inspections/${encodeURIComponent(inspectionUuid)}/items/${encodeURIComponent(lineUuid)}`,
      { method: "POST", token, body: JSON.stringify(attrs) },
    );
    revalidateInspection(inspectionUuid);
    return { ok: true, item: res.inspection_item };
  } catch (err) {
    return toErrorResult(err, {
      source: "upsertItemAction",
      fallbackDetail: "Couldn't save the line decision.",
    });
  }
}

export async function signOperatorAction(
  uuid: string,
  signatureImage: string,
): Promise<InspectionResult> {
  const token = await activeToken();
  if (!token) return unauthorizedResult("signOperatorAction");
  try {
    const res = await api<{ goods_in_inspection: Inspection }>(
      `/api/goods-in-inspections/${encodeURIComponent(uuid)}/sign-operator`,
      {
        method: "POST",
        token,
        body: JSON.stringify({ signature_image: signatureImage }),
      },
    );
    revalidateInspection(uuid);
    return { ok: true, inspection: res.goods_in_inspection };
  } catch (err) {
    return toErrorResult(err, {
      source: "signOperatorAction",
      fallbackDetail: "Couldn't sign as operator.",
    });
  }
}

export async function signQualityAction(
  uuid: string,
  signatureImage: string,
  decision: QualityDecision,
  reason?: string | null,
): Promise<InspectionResult> {
  const token = await activeToken();
  if (!token) return unauthorizedResult("signQualityAction");
  try {
    const res = await api<{ goods_in_inspection: Inspection }>(
      `/api/goods-in-inspections/${encodeURIComponent(uuid)}/sign-quality`,
      {
        method: "POST",
        token,
        body: JSON.stringify({
          signature_image: signatureImage,
          quality_decision: decision,
          quality_decision_reason: reason ?? null,
        }),
      },
    );
    revalidateInspection(uuid);
    return { ok: true, inspection: res.goods_in_inspection };
  } catch (err) {
    return toErrorResult(err, {
      source: "signQualityAction",
      fallbackDetail: "Couldn't sign as quality approver.",
    });
  }
}

/** Multipart photo upload. Caller builds the FormData (with the
 *  `file` part + optional `kind`); we forward straight to Phoenix. */
export async function uploadInspectionFileAction(
  uuid: string,
  formData: FormData,
): Promise<InspectionFileResult> {
  const token = await activeToken();
  if (!token) return unauthorizedResult("uploadInspectionFileAction");
  try {
    const res = await api<{ file: InspectionFile }>(
      `/api/goods-in-inspections/${encodeURIComponent(uuid)}/files`,
      { method: "POST", token, body: formData },
    );
    revalidateInspection(uuid);
    return { ok: true, file: res.file };
  } catch (err) {
    return toErrorResult(err, {
      source: "uploadInspectionFileAction",
      fallbackDetail: "Couldn't upload the photo.",
    });
  }
}

export async function deleteInspectionFileAction(
  uuid: string,
  fileUuid: string,
): Promise<DeleteResult> {
  const token = await activeToken();
  if (!token) return unauthorizedResult("deleteInspectionFileAction");
  try {
    await api<void>(
      `/api/goods-in-inspections/${encodeURIComponent(uuid)}/files/${encodeURIComponent(fileUuid)}`,
      { method: "DELETE", token },
    );
    revalidateInspection(uuid);
    return { ok: true };
  } catch (err) {
    return toErrorResult(err, {
      source: "deleteInspectionFileAction",
      fallbackDetail: "Couldn't remove the photo.",
    });
  }
}
