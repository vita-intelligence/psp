"use server";

import { revalidatePath } from "next/cache";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { Certificate, CertificateType, ItemCertificate } from "../types";
import {
  toErrorResult,
  unauthorizedResult,
  type ErrorResult,
} from "../errors/server";

export type CertificateResult =
  | { ok: true; certificate: Certificate }
  | ErrorResult;
export type AttachmentResult =
  | { ok: true; item_certificate: ItemCertificate }
  | ErrorResult;
export type DeleteResult = { ok: true } | ErrorResult;

interface CertificateInput {
  name?: string;
  certificate_type?: CertificateType;
  issuing_body?: string | null;
  default_validity_months?: number | null;
  description?: string | null;
  is_active?: boolean;
}

// ----- certificate registry --------------------------------------

export async function createCertificateAction(
  input: CertificateInput,
): Promise<CertificateResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("createCertificateAction");

  try {
    const res = await api<{ certificate: Certificate }>(`/api/certificates`, {
      method: "POST",
      token,
      body: JSON.stringify(input),
    });
    revalidatePath(`/settings/certificates`);
    return { ok: true, certificate: res.certificate };
  } catch (err) {
    return toErrorResult(err, {
      source: "createCertificateAction",
      fallbackDetail: "Couldn't create the certificate.",
    });
  }
}

export async function updateCertificateAction(
  uuid: string,
  input: CertificateInput,
): Promise<CertificateResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("updateCertificateAction");

  try {
    const res = await api<{ certificate: Certificate }>(
      `/api/certificates/${uuid}`,
      { method: "PUT", token, body: JSON.stringify(input) },
    );
    revalidatePath(`/settings/certificates`);
    return { ok: true, certificate: res.certificate };
  } catch (err) {
    return toErrorResult(err, {
      source: "updateCertificateAction",
      fallbackDetail: "Couldn't update the certificate.",
    });
  }
}

export async function deleteCertificateAction(
  uuid: string,
): Promise<DeleteResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("deleteCertificateAction");

  try {
    await api<void>(`/api/certificates/${uuid}`, { method: "DELETE", token });
    revalidatePath(`/settings/certificates`);
    return { ok: true };
  } catch (err) {
    return toErrorResult(err, {
      source: "deleteCertificateAction",
      fallbackDetail: "Couldn't delete the certificate.",
    });
  }
}

// ----- per-item attachments --------------------------------------

interface AttachmentInput {
  certificate_id?: number;
  certificate_number?: string | null;
  valid_from?: string | null;
  valid_until?: string | null;
  document_url?: string | null;
  notes?: string | null;
}

export async function attachCertificateAction(
  itemUuid: string,
  input: AttachmentInput,
): Promise<AttachmentResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("attachCertificateAction");

  try {
    const res = await api<{ item_certificate: ItemCertificate }>(
      `/api/items/${itemUuid}/certificates`,
      { method: "POST", token, body: JSON.stringify(input) },
    );
    revalidatePath(`/production/items/${itemUuid}`);
    return { ok: true, item_certificate: res.item_certificate };
  } catch (err) {
    return toErrorResult(err, {
      source: "attachCertificateAction",
      fallbackDetail: "Couldn't attach the certificate.",
    });
  }
}

export async function updateAttachmentAction(
  itemUuid: string,
  attUuid: string,
  input: AttachmentInput,
): Promise<AttachmentResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("updateAttachmentAction");

  try {
    const res = await api<{ item_certificate: ItemCertificate }>(
      `/api/items/${itemUuid}/certificates/${attUuid}`,
      { method: "PUT", token, body: JSON.stringify(input) },
    );
    revalidatePath(`/production/items/${itemUuid}`);
    return { ok: true, item_certificate: res.item_certificate };
  } catch (err) {
    return toErrorResult(err, {
      source: "updateAttachmentAction",
      fallbackDetail: "Couldn't update the certificate attachment.",
    });
  }
}

export async function detachCertificateAction(
  itemUuid: string,
  attUuid: string,
): Promise<DeleteResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("detachCertificateAction");

  try {
    await api<void>(`/api/items/${itemUuid}/certificates/${attUuid}`, {
      method: "DELETE",
      token,
    });
    revalidatePath(`/production/items/${itemUuid}`);
    return { ok: true };
  } catch (err) {
    return toErrorResult(err, {
      source: "detachCertificateAction",
      fallbackDetail: "Couldn't detach the certificate.",
    });
  }
}
