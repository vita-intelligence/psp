"use server";

import { revalidatePath } from "next/cache";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type {
  Customer,
  CustomerAmlOutcome,
  CustomerApprovalStatus,
  CustomerContact,
  CustomerContactEvent,
  CustomerContactEventKind,
  CustomerContactKind,
  CustomerCreditCheckOutcome,
  CustomerFile,
  CustomerPaymentBasis,
} from "../types";
import {
  toErrorResult,
  unauthorizedResult,
  type ErrorResult,
} from "../errors/server";

export type CustomerResult = { ok: true; customer: Customer } | ErrorResult;
export type ContactResult = { ok: true; contact: CustomerContact } | ErrorResult;
export type ContactEventResult =
  | { ok: true; event: CustomerContactEvent; customer: Customer }
  | ErrorResult;
export type CustomerFileResult = { ok: true; file: CustomerFile } | ErrorResult;
export type CustomerDeleteResult = { ok: true } | ErrorResult;

export interface CustomerInput {
  name?: string;
  legal_name?: string | null;
  contact_name?: string | null;
  website?: string | null;
  legal_address?: string | null;
  country_code?: string | null;
  registration_number?: string | null;
  tax_number?: string | null;
  currency_code?: string;
  tax_rate?: string | null;
  default_discount_percent?: string | null;
  language_code?: string | null;
  payment_terms_days?: number;
  payment_terms_basis?: CustomerPaymentBasis;
  trade_credit_limit?: string | null;
  pricelist_id?: number | null;
  contact_frequency_months?: number | null;
  account_manager_id?: number | null;
  is_active?: boolean;
}

export async function createCustomerAction(
  input: CustomerInput,
): Promise<CustomerResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("createCustomerAction");

  try {
    const res = await api<{ customer: Customer }>("/api/customers", {
      method: "POST",
      token,
      body: JSON.stringify(input),
    });
    revalidatePath("/sales/customers");
    return { ok: true, customer: res.customer };
  } catch (err) {
    return toErrorResult(err, {
      source: "createCustomerAction",
      fallbackDetail: "Couldn't create the customer.",
    });
  }
}

export async function updateCustomerAction(
  uuid: string,
  input: CustomerInput,
): Promise<CustomerResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("updateCustomerAction");

  try {
    const res = await api<{ customer: Customer }>(
      `/api/customers/${encodeURIComponent(uuid)}`,
      { method: "PUT", token, body: JSON.stringify(input) },
    );
    revalidatePath("/sales/customers");
    revalidatePath(`/sales/customers/${uuid}`);
    return { ok: true, customer: res.customer };
  } catch (err) {
    return toErrorResult(err, {
      source: "updateCustomerAction",
      fallbackDetail: "Couldn't update the customer.",
    });
  }
}

export async function deleteCustomerAction(
  uuid: string,
): Promise<CustomerDeleteResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("deleteCustomerAction");

  try {
    await api<void>(`/api/customers/${encodeURIComponent(uuid)}`, {
      method: "DELETE",
      token,
    });
    revalidatePath("/sales/customers");
    return { ok: true };
  } catch (err) {
    return toErrorResult(err, {
      source: "deleteCustomerAction",
      fallbackDetail: "Couldn't delete the customer.",
    });
  }
}

export interface CustomerQualificationInput {
  // KYC
  kyc_verified_at?: string | null;
  kyc_verified_by_id?: number | null;
  kyc_file_id?: number | null;
  kyc_notes?: string | null;
  // Credit check
  credit_check_at?: string | null;
  credit_check_by_id?: number | null;
  credit_check_outcome?: CustomerCreditCheckOutcome | null;
  credit_check_score?: string | null;
  credit_check_file_id?: number | null;
  credit_check_notes?: string | null;
  // AML
  aml_screened_at?: string | null;
  aml_screened_by_id?: number | null;
  aml_outcome?: CustomerAmlOutcome | null;
  aml_notes?: string | null;
  // Contract
  contract_signed_at?: string | null;
  contract_signed_by_id?: number | null;
  contract_file_id?: number | null;
  contract_notes?: string | null;
  // Re-qualification cadence
  review_frequency_months?: number | null;
  last_review_at?: string | null;
  next_review_at?: string | null;
}

/** Record an onboarding artifact (KYC / Credit / AML / Contract) +
 *  optionally update the re-qualification cadence. Stamps
 *  `qualified_by` + `qualified_at` so the approve action can enforce
 *  segregation of duties on the signer. */
export async function updateCustomerQualificationAction(
  uuid: string,
  input: CustomerQualificationInput,
): Promise<CustomerResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("updateCustomerQualificationAction");

  try {
    const res = await api<{ customer: Customer }>(
      `/api/customers/${encodeURIComponent(uuid)}/qualification`,
      { method: "PUT", token, body: JSON.stringify(input) },
    );
    revalidatePath("/sales/customers");
    revalidatePath(`/sales/customers/${uuid}`);
    return { ok: true, customer: res.customer };
  } catch (err) {
    return toErrorResult(err, {
      source: "updateCustomerQualificationAction",
      fallbackDetail: "Couldn't record the onboarding artifact.",
    });
  }
}

/** Approval transition (4-eyes — approver must differ from whoever
 *  collected the qualification evidence). Server returns 409 on
 *  segregation-of-duties violation; 422 with `missing[]` when the
 *  KYC / Credit / AML / Contract checklist isn't complete. */
export async function approveCustomerAction(
  uuid: string,
  input: { approval_status: CustomerApprovalStatus; approval_notes?: string | null },
): Promise<CustomerResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("approveCustomerAction");

  try {
    const res = await api<{ customer: Customer }>(
      `/api/customers/${encodeURIComponent(uuid)}/approval`,
      { method: "PUT", token, body: JSON.stringify(input) },
    );
    revalidatePath("/sales/customers");
    revalidatePath(`/sales/customers/${uuid}`);
    return { ok: true, customer: res.customer };
  } catch (err) {
    return toErrorResult(err, {
      source: "approveCustomerAction",
      fallbackDetail: "Couldn't update the customer approval.",
    });
  }
}

// ----- contact rows ---------------------------------------------

export interface CustomerContactInput {
  kind: CustomerContactKind;
  value: string;
  label?: string | null;
  is_primary?: boolean;
}

export async function addCustomerContactAction(
  customerUuid: string,
  input: CustomerContactInput,
): Promise<ContactResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("addCustomerContactAction");

  try {
    const res = await api<{ contact: CustomerContact }>(
      `/api/customers/${encodeURIComponent(customerUuid)}/contacts`,
      { method: "POST", token, body: JSON.stringify(input) },
    );
    revalidatePath(`/sales/customers/${customerUuid}`);
    return { ok: true, contact: res.contact };
  } catch (err) {
    return toErrorResult(err, {
      source: "addCustomerContactAction",
      fallbackDetail: "Couldn't add the contact.",
    });
  }
}

export async function updateCustomerContactAction(
  customerUuid: string,
  contactUuid: string,
  input: Partial<CustomerContactInput>,
): Promise<ContactResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("updateCustomerContactAction");

  try {
    const res = await api<{ contact: CustomerContact }>(
      `/api/customers/${encodeURIComponent(customerUuid)}/contacts/${encodeURIComponent(contactUuid)}`,
      { method: "PUT", token, body: JSON.stringify(input) },
    );
    revalidatePath(`/sales/customers/${customerUuid}`);
    return { ok: true, contact: res.contact };
  } catch (err) {
    return toErrorResult(err, {
      source: "updateCustomerContactAction",
      fallbackDetail: "Couldn't update the contact.",
    });
  }
}

export async function removeCustomerContactAction(
  customerUuid: string,
  contactUuid: string,
): Promise<CustomerDeleteResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("removeCustomerContactAction");

  try {
    await api<void>(
      `/api/customers/${encodeURIComponent(customerUuid)}/contacts/${encodeURIComponent(contactUuid)}`,
      { method: "DELETE", token },
    );
    revalidatePath(`/sales/customers/${customerUuid}`);
    return { ok: true };
  } catch (err) {
    return toErrorResult(err, {
      source: "removeCustomerContactAction",
      fallbackDetail: "Couldn't remove the contact.",
    });
  }
}

// ----- contact-event log ----------------------------------------

export interface ContactEventInput {
  kind: CustomerContactEventKind;
  occurred_at?: string;
  summary?: string | null;
}

export async function logCustomerContactEventAction(
  customerUuid: string,
  input: ContactEventInput,
): Promise<ContactEventResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("logCustomerContactEventAction");

  try {
    const res = await api<{ event: CustomerContactEvent; customer: Customer }>(
      `/api/customers/${encodeURIComponent(customerUuid)}/contact-events`,
      { method: "POST", token, body: JSON.stringify(input) },
    );
    revalidatePath("/sales/customers");
    revalidatePath(`/sales/customers/${customerUuid}`);
    return { ok: true, event: res.event, customer: res.customer };
  } catch (err) {
    return toErrorResult(err, {
      source: "logCustomerContactEventAction",
      fallbackDetail: "Couldn't log the contact event.",
    });
  }
}

// ----- files ----------------------------------------------------

export async function uploadCustomerFileAction(
  customerUuid: string,
  formData: FormData,
): Promise<CustomerFileResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("uploadCustomerFileAction");

  try {
    const res = await api<{ file: CustomerFile }>(
      `/api/customers/${encodeURIComponent(customerUuid)}/files`,
      { method: "POST", token, body: formData },
    );
    revalidatePath(`/sales/customers/${customerUuid}`);
    return { ok: true, file: res.file };
  } catch (err) {
    return toErrorResult(err, {
      source: "uploadCustomerFileAction",
      fallbackDetail: "Couldn't upload the file.",
    });
  }
}

export async function removeCustomerFileAction(
  customerUuid: string,
  fileUuid: string,
): Promise<CustomerDeleteResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("removeCustomerFileAction");

  try {
    await api<void>(
      `/api/customers/${encodeURIComponent(customerUuid)}/files/${encodeURIComponent(fileUuid)}`,
      { method: "DELETE", token },
    );
    revalidatePath(`/sales/customers/${customerUuid}`);
    return { ok: true };
  } catch (err) {
    return toErrorResult(err, {
      source: "removeCustomerFileAction",
      fallbackDetail: "Couldn't remove the file.",
    });
  }
}
