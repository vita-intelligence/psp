"use server";

import { revalidatePath } from "next/cache";
import { api } from "../api";
import { getDeviceToken } from "../devices/server";
import { getSessionToken } from "../auth/server";
import {
  syntheticErrorResult,
  toErrorResult,
  type ErrorResult,
} from "../errors/server";
import type { ManufacturingOrderBooking } from "../production/types";

export type PreflightBookingResult =
  | {
      ok: true;
      booking: ManufacturingOrderBooking;
      preflight_complete: boolean;
    }
  | (ErrorResult & { ok: false });

async function token(): Promise<string | null> {
  return (await getDeviceToken()) ?? (await getSessionToken());
}

function unauthorized(source: string): ErrorResult {
  return syntheticErrorResult({
    source,
    code: "unauthorized",
    detail: "Device isn't signed in. Pair it again from your laptop.",
  });
}

/**
 * Stamp `received_at` / `received_by` / `received_qty` / `received_notes`
 * on a single booking. Idempotent — re-confirming an already-received
 * booking is a no-op (with the new notes / qty merged in).
 */
export async function confirmBookingReceivedAction(
  moUuid: string,
  bookingUuid: string,
  input: { received_qty: string; received_notes: string | null },
): Promise<PreflightBookingResult> {
  const t = await token();
  if (!t) return unauthorized("confirmBookingReceivedAction");
  try {
    const { booking, preflight_complete } = await api<{
      booking: ManufacturingOrderBooking;
      preflight_complete: boolean;
    }>(
      `/api/m/preflight/${encodeURIComponent(moUuid)}/bookings/${encodeURIComponent(bookingUuid)}/receive`,
      {
        method: "POST",
        token: t,
        body: JSON.stringify({
          received_qty: input.received_qty,
          received_notes: input.received_notes,
        }),
      },
    );
    revalidatePath(`/m/preflight/${moUuid}`);
    revalidatePath(`/m/preflight`);
    return { ok: true, booking, preflight_complete };
  } catch (err) {
    return toErrorResult(err, {
      source: "confirmBookingReceivedAction",
      fallbackDetail: "Couldn't confirm receipt.",
    });
  }
}
