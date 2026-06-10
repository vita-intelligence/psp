"use server";

import { revalidatePath } from "next/cache";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type {
  Vendor,
  VendorApprovalStatus,
  VendorApprovedItemRow,
  VendorCertificateAttachment,
  VendorFile,
  VendorPaymentBasis,
  VendorQuestionnaireStatus,
  VendorRisk,
  VendorSupplyChainType,
  VendorTraceabilityStatus,
} from "../types";
import {
  toErrorResult,
  unauthorizedResult,
  type ErrorResult,
} from "../errors/server";

export type VendorResult = { ok: true; vendor: Vendor } | ErrorResult;
export type ApprovedItemResult =
  | { ok: true; approved_item: VendorApprovedItemRow }
  | ErrorResult;
export type CertificateResult =
  | { ok: true; certificate: VendorCertificateAttachment }
  | ErrorResult;
export type DeleteResult = { ok: true } | ErrorResult;

export interface VendorInput {
  name?: string;
  legal_name?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  contact_name?: string | null;
  legal_address?: string | null;
  registration_number?: string | null;
  tax_number?: string | null;
  tax_rate?: string | null;
  currency_code?: string;
  default_lead_time_days?: number;
  payment_terms_days?: number;
  payment_basis?: VendorPaymentBasis;
  supply_chain_type?: VendorSupplyChainType | null;
  vendor_risk?: VendorRisk | null;
  product_types?: string[];
  questionnaire_status?: VendorQuestionnaireStatus;
  traceability_verification_status?: VendorTraceabilityStatus;
  review_frequency_months?: number | null;
  last_review_at?: string | null;
  next_review_at?: string | null;
  notes?: string | null;
  is_active?: boolean;
}

export async function createVendorAction(
  input: VendorInput,
): Promise<VendorResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("createVendorAction");

  try {
    const res = await api<{ vendor: Vendor }>("/api/vendors", {
      method: "POST",
      token,
      body: JSON.stringify(input),
    });
    revalidatePath("/procurement/vendors");
    return { ok: true, vendor: res.vendor };
  } catch (err) {
    return toErrorResult(err, {
      source: "createVendorAction",
      fallbackDetail: "Couldn't create the vendor.",
    });
  }
}

export async function updateVendorAction(
  uuid: string,
  input: VendorInput,
): Promise<VendorResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("updateVendorAction");

  try {
    const res = await api<{ vendor: Vendor }>(
      `/api/vendors/${encodeURIComponent(uuid)}`,
      { method: "PUT", token, body: JSON.stringify(input) },
    );
    revalidatePath("/procurement/vendors");
    revalidatePath(`/procurement/vendors/${uuid}`);
    return { ok: true, vendor: res.vendor };
  } catch (err) {
    return toErrorResult(err, {
      source: "updateVendorAction",
      fallbackDetail: "Couldn't update the vendor.",
    });
  }
}

export async function deleteVendorAction(uuid: string): Promise<DeleteResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("deleteVendorAction");

  try {
    await api<void>(`/api/vendors/${encodeURIComponent(uuid)}`, {
      method: "DELETE",
      token,
    });
    revalidatePath("/procurement/vendors");
    return { ok: true };
  } catch (err) {
    return toErrorResult(err, {
      source: "deleteVendorAction",
      fallbackDetail: "Couldn't delete the vendor.",
    });
  }
}

/** Approval transition. Pass `approval_status` + optional notes; backend
 *  stamps `approved_by` + `approved_at` on the "approved" branch.
 *
 *  Two regulatory guards on the server side that surface as specific
 *  error results here so the UI can render a useful banner:
 *
 *    - 422 `qualification_incomplete` — the artifact checklist isn't
 *      cleared. The error payload carries `missing[]` so the FE can
 *      point at the gap.
 *    - 409 `same_signer_as_qualifier` — segregation of duties. The
 *      person who recorded the qualification evidence can't also sign
 *      it off.
 */
export async function approveVendorAction(
  uuid: string,
  input: { approval_status: VendorApprovalStatus; approval_notes?: string | null },
): Promise<VendorResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("approveVendorAction");

  try {
    const res = await api<{ vendor: Vendor }>(
      `/api/vendors/${encodeURIComponent(uuid)}/approval`,
      { method: "PUT", token, body: JSON.stringify(input) },
    );
    revalidatePath("/procurement/vendors");
    revalidatePath(`/procurement/vendors/${uuid}`);
    return { ok: true, vendor: res.vendor };
  } catch (err) {
    return toErrorResult(err, {
      source: "approveVendorAction",
      fallbackDetail: "Couldn't update the vendor approval.",
    });
  }
}

export interface VendorQualificationInput {
  saq_received_at?: string | null;
  saq_file_id?: number | null;
  risk_assessment_completed_at?: string | null;
  risk_assessment_notes?: string | null;
  audit_required?: boolean;
  audit_completed_at?: string | null;
  audit_kind?: "desk" | "onsite" | "virtual" | null;
  audit_outcome?: "pass" | "pass_with_findings" | "fail" | null;
  audit_file_id?: number | null;
  audit_notes?: string | null;
  coa_received_at?: string | null;
  coa_file_id?: number | null;
}

export type UploadFileResult = { ok: true; file: VendorFile } | ErrorResult;

/** Multipart upload of a vendor evidence file (SAQ / audit / COA /
 *  cert PDF). Bytes go to `Backend.Storage`; the returned `file.id`
 *  + `file.uuid` are what the qualification + cert writes reference.
 *
 *  Called from a client component using `useTransition` + `FormData`. */
export async function uploadVendorFileAction(
  vendorUuid: string,
  formData: FormData,
): Promise<UploadFileResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("uploadVendorFileAction");

  try {
    const res = await api<{ file: VendorFile }>(
      `/api/vendors/${encodeURIComponent(vendorUuid)}/files`,
      { method: "POST", token, body: formData },
    );
    revalidatePath(`/procurement/vendors/${vendorUuid}`);
    return { ok: true, file: res.file };
  } catch (err) {
    return toErrorResult(err, {
      source: "uploadVendorFileAction",
      fallbackDetail: "Couldn't upload the file.",
    });
  }
}

/** Record qualification artifacts (SAQ / risk-assessment / audit /
 *  COA). Stamps `qualified_by` + `qualified_at` so the approve action
 *  can enforce segregation-of-duties on the signer. */
export async function updateVendorQualificationAction(
  uuid: string,
  input: VendorQualificationInput,
): Promise<VendorResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("updateVendorQualificationAction");

  try {
    const res = await api<{ vendor: Vendor }>(
      `/api/vendors/${encodeURIComponent(uuid)}/qualification`,
      { method: "PUT", token, body: JSON.stringify(input) },
    );
    revalidatePath("/procurement/vendors");
    revalidatePath(`/procurement/vendors/${uuid}`);
    return { ok: true, vendor: res.vendor };
  } catch (err) {
    return toErrorResult(err, {
      source: "updateVendorQualificationAction",
      fallbackDetail: "Couldn't record the qualification artifact.",
    });
  }
}

export async function addApprovedItemAction(
  vendorUuid: string,
  itemId: number,
  notes?: string | null,
): Promise<ApprovedItemResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("addApprovedItemAction");

  try {
    const res = await api<{ approved_item: VendorApprovedItemRow }>(
      `/api/vendors/${encodeURIComponent(vendorUuid)}/approved-items`,
      {
        method: "POST",
        token,
        body: JSON.stringify({ item_id: itemId, notes: notes ?? null }),
      },
    );
    revalidatePath(`/procurement/vendors/${vendorUuid}`);
    return { ok: true, approved_item: res.approved_item };
  } catch (err) {
    return toErrorResult(err, {
      source: "addApprovedItemAction",
      fallbackDetail: "Couldn't add the item to the approved list.",
    });
  }
}

export async function removeApprovedItemAction(
  vendorUuid: string,
  rowUuid: string,
): Promise<DeleteResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("removeApprovedItemAction");

  try {
    await api<void>(
      `/api/vendors/${encodeURIComponent(vendorUuid)}/approved-items/${encodeURIComponent(rowUuid)}`,
      { method: "DELETE", token },
    );
    revalidatePath(`/procurement/vendors/${vendorUuid}`);
    return { ok: true };
  } catch (err) {
    return toErrorResult(err, {
      source: "removeApprovedItemAction",
      fallbackDetail: "Couldn't remove the item from the approved list.",
    });
  }
}

export interface VendorCertificateInput {
  certificate_id?: number;
  certificate_number?: string | null;
  valid_from?: string | null;
  valid_until?: string | null;
  document_file_id?: number | null;
  notes?: string | null;
}

export async function attachVendorCertificateAction(
  vendorUuid: string,
  input: VendorCertificateInput,
): Promise<CertificateResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("attachVendorCertificateAction");

  try {
    const res = await api<{ certificate: VendorCertificateAttachment }>(
      `/api/vendors/${encodeURIComponent(vendorUuid)}/certificates`,
      { method: "POST", token, body: JSON.stringify(input) },
    );
    revalidatePath(`/procurement/vendors/${vendorUuid}`);
    return { ok: true, certificate: res.certificate };
  } catch (err) {
    return toErrorResult(err, {
      source: "attachVendorCertificateAction",
      fallbackDetail: "Couldn't attach the certificate.",
    });
  }
}

export async function updateVendorCertificateAction(
  vendorUuid: string,
  rowUuid: string,
  input: VendorCertificateInput,
): Promise<CertificateResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("updateVendorCertificateAction");

  try {
    const res = await api<{ certificate: VendorCertificateAttachment }>(
      `/api/vendors/${encodeURIComponent(vendorUuid)}/certificates/${encodeURIComponent(rowUuid)}`,
      { method: "PUT", token, body: JSON.stringify(input) },
    );
    revalidatePath(`/procurement/vendors/${vendorUuid}`);
    return { ok: true, certificate: res.certificate };
  } catch (err) {
    return toErrorResult(err, {
      source: "updateVendorCertificateAction",
      fallbackDetail: "Couldn't update the certificate.",
    });
  }
}

export async function removeVendorCertificateAction(
  vendorUuid: string,
  rowUuid: string,
): Promise<DeleteResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("removeVendorCertificateAction");

  try {
    await api<void>(
      `/api/vendors/${encodeURIComponent(vendorUuid)}/certificates/${encodeURIComponent(rowUuid)}`,
      { method: "DELETE", token },
    );
    revalidatePath(`/procurement/vendors/${vendorUuid}`);
    return { ok: true };
  } catch (err) {
    return toErrorResult(err, {
      source: "removeVendorCertificateAction",
      fallbackDetail: "Couldn't remove the certificate.",
    });
  }
}
