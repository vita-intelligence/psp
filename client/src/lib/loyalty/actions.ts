"use server";

import { revalidatePath } from "next/cache";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type {
  CustomerCredit,
  LoyaltyBasis,
  LoyaltyPayoutKind,
  LoyaltyProgram,
  LoyaltyScheme,
  LoyaltyTier,
} from "../types";
import {
  toErrorResult,
  unauthorizedResult,
  type ErrorResult,
} from "../errors/server";

export type LoyaltyProgramResult =
  | { ok: true; loyalty_program: LoyaltyProgram }
  | ErrorResult;
export type LoyaltyTierResult =
  | { ok: true; loyalty_program_tier: LoyaltyTier }
  | ErrorResult;
export type LoyaltyDeleteResult = { ok: true } | ErrorResult;
export type CustomerCreditResult =
  | { ok: true; customer_credit: CustomerCredit }
  | ErrorResult;

// ----- programs -------------------------------------------------

export interface LoyaltyProgramInput {
  name?: string;
  description?: string | null;
  scheme?: LoyaltyScheme;
  basis?: LoyaltyBasis;
  payout_kind?: LoyaltyPayoutKind;
}

export async function createLoyaltyProgramAction(
  input: LoyaltyProgramInput,
): Promise<LoyaltyProgramResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("createLoyaltyProgramAction");

  try {
    const res = await api<{ loyalty_program: LoyaltyProgram }>(
      "/api/loyalty/programs",
      { method: "POST", token, body: JSON.stringify(input) },
    );
    revalidatePath("/sales/loyalty");
    return { ok: true, loyalty_program: res.loyalty_program };
  } catch (err) {
    return toErrorResult(err, {
      source: "createLoyaltyProgramAction",
      fallbackDetail: "Couldn't create the loyalty program.",
    });
  }
}

export async function updateLoyaltyProgramAction(
  uuid: string,
  input: LoyaltyProgramInput,
): Promise<LoyaltyProgramResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("updateLoyaltyProgramAction");

  try {
    const res = await api<{ loyalty_program: LoyaltyProgram }>(
      `/api/loyalty/programs/${encodeURIComponent(uuid)}`,
      { method: "PUT", token, body: JSON.stringify(input) },
    );
    revalidatePath("/sales/loyalty");
    revalidatePath(`/sales/loyalty/programs/${uuid}`);
    return { ok: true, loyalty_program: res.loyalty_program };
  } catch (err) {
    return toErrorResult(err, {
      source: "updateLoyaltyProgramAction",
      fallbackDetail: "Couldn't update the loyalty program.",
    });
  }
}

export async function deleteLoyaltyProgramAction(
  uuid: string,
): Promise<LoyaltyDeleteResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("deleteLoyaltyProgramAction");

  try {
    await api<void>(`/api/loyalty/programs/${encodeURIComponent(uuid)}`, {
      method: "DELETE",
      token,
    });
    revalidatePath("/sales/loyalty");
    return { ok: true };
  } catch (err) {
    return toErrorResult(err, {
      source: "deleteLoyaltyProgramAction",
      fallbackDetail: "Couldn't delete the loyalty program.",
    });
  }
}

export async function setProgramActiveAction(
  uuid: string,
  is_active: boolean,
  reason?: string,
): Promise<LoyaltyProgramResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("setProgramActiveAction");

  try {
    const res = await api<{ loyalty_program: LoyaltyProgram }>(
      `/api/loyalty/programs/${encodeURIComponent(uuid)}/set-active`,
      {
        method: "POST",
        token,
        body: JSON.stringify({ is_active, reason: reason ?? null }),
      },
    );
    revalidatePath("/sales/loyalty");
    revalidatePath(`/sales/loyalty/programs/${uuid}`);
    return { ok: true, loyalty_program: res.loyalty_program };
  } catch (err) {
    return toErrorResult(err, {
      source: "setProgramActiveAction",
      fallbackDetail: is_active
        ? "Couldn't activate the program."
        : "Couldn't deactivate the program.",
    });
  }
}

export async function setProgramDefaultAction(
  uuid: string,
): Promise<LoyaltyProgramResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("setProgramDefaultAction");

  try {
    const res = await api<{ loyalty_program: LoyaltyProgram }>(
      `/api/loyalty/programs/${encodeURIComponent(uuid)}/set-default`,
      { method: "POST", token },
    );
    revalidatePath("/sales/loyalty");
    revalidatePath(`/sales/loyalty/programs/${uuid}`);
    return { ok: true, loyalty_program: res.loyalty_program };
  } catch (err) {
    return toErrorResult(err, {
      source: "setProgramDefaultAction",
      fallbackDetail: "Couldn't set the program as default.",
    });
  }
}

// ----- tiers ----------------------------------------------------

export interface LoyaltyTierInput {
  rank?: number;
  min_threshold?: string;
  rate_pct?: string;
  label?: string | null;
}

export async function addTierAction(
  programUuid: string,
  input: LoyaltyTierInput,
): Promise<LoyaltyTierResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("addTierAction");

  try {
    const res = await api<{ loyalty_program_tier: LoyaltyTier }>(
      `/api/loyalty/programs/${encodeURIComponent(programUuid)}/tiers`,
      { method: "POST", token, body: JSON.stringify(input) },
    );
    revalidatePath(`/sales/loyalty/programs/${programUuid}`);
    return { ok: true, loyalty_program_tier: res.loyalty_program_tier };
  } catch (err) {
    return toErrorResult(err, {
      source: "addTierAction",
      fallbackDetail: "Couldn't add the tier.",
    });
  }
}

export async function updateTierAction(
  programUuid: string,
  tierUuid: string,
  input: LoyaltyTierInput,
): Promise<LoyaltyTierResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("updateTierAction");

  try {
    const res = await api<{ loyalty_program_tier: LoyaltyTier }>(
      `/api/loyalty/programs/${encodeURIComponent(programUuid)}/tiers/${encodeURIComponent(tierUuid)}`,
      { method: "PUT", token, body: JSON.stringify(input) },
    );
    revalidatePath(`/sales/loyalty/programs/${programUuid}`);
    return { ok: true, loyalty_program_tier: res.loyalty_program_tier };
  } catch (err) {
    return toErrorResult(err, {
      source: "updateTierAction",
      fallbackDetail: "Couldn't update the tier.",
    });
  }
}

export async function deleteTierAction(
  programUuid: string,
  tierUuid: string,
): Promise<LoyaltyDeleteResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("deleteTierAction");

  try {
    await api<void>(
      `/api/loyalty/programs/${encodeURIComponent(programUuid)}/tiers/${encodeURIComponent(tierUuid)}`,
      { method: "DELETE", token },
    );
    revalidatePath(`/sales/loyalty/programs/${programUuid}`);
    return { ok: true };
  } catch (err) {
    return toErrorResult(err, {
      source: "deleteTierAction",
      fallbackDetail: "Couldn't delete the tier.",
    });
  }
}

// ----- credits --------------------------------------------------

export interface GrantCreditInput {
  amount: string;
  currency_code: string;
  reason?: string | null;
}

export async function grantCreditAction(
  customerUuid: string,
  input: GrantCreditInput,
): Promise<CustomerCreditResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("grantCreditAction");

  try {
    const res = await api<{ customer_credit: CustomerCredit }>(
      `/api/customers/${encodeURIComponent(customerUuid)}/credits/grant`,
      { method: "POST", token, body: JSON.stringify(input) },
    );
    revalidatePath("/sales/loyalty");
    revalidatePath(`/sales/customers/${customerUuid}`);
    return { ok: true, customer_credit: res.customer_credit };
  } catch (err) {
    return toErrorResult(err, {
      source: "grantCreditAction",
      fallbackDetail: "Couldn't grant the credit.",
    });
  }
}

export interface ApplyCreditInput {
  invoice_uuid: string;
  amount: string;
}

export async function applyCreditToInvoiceAction(
  customerUuid: string,
  input: ApplyCreditInput,
): Promise<CustomerCreditResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("applyCreditToInvoiceAction");

  try {
    const res = await api<{ customer_credit: CustomerCredit }>(
      `/api/customers/${encodeURIComponent(customerUuid)}/credits/apply`,
      { method: "POST", token, body: JSON.stringify(input) },
    );
    revalidatePath("/sales/loyalty");
    revalidatePath(`/sales/customers/${customerUuid}`);
    revalidatePath("/sales/invoices");
    return { ok: true, customer_credit: res.customer_credit };
  } catch (err) {
    return toErrorResult(err, {
      source: "applyCreditToInvoiceAction",
      fallbackDetail: "Couldn't apply the credit.",
    });
  }
}
