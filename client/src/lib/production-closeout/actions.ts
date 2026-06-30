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
import type {
  ManufacturingOrderBooking,
} from "../production/types";

export interface CloseBookingInput {
  /** Decimal string. Default = "0" (fully consumed). */
  remaining_qty: string;
  /** Dispatch cell uuid the operator scanned. Required when
   *  remaining_qty > 0; null otherwise. */
  scanned_cell_uuid: string | null;
  /** Stock-movement photo. One of `photo_url` or `skip_photo_reason`
   *  must be set — the closeout panel gates the submit CTA on it. */
  photo_url: string | null;
  /** Reason the operator couldn't take a photo (camera offline, lot
   *  packaging hides the labels, etc.). Required when `photo_url` is
   *  null. Mirrors return-pickup's photo-or-skip pattern. */
  skip_photo_reason: string | null;
}

export type CloseoutBookingResult =
  | { ok: true; booking: ManufacturingOrderBooking }
  | ErrorResult;

export type CloseoutOutputResult =
  | { ok: true; lot: { status: string } }
  | ErrorResult;

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

/** Close out one booking — stamp consumed + (if any qty remains)
 *  move the remainder to the scanned production-dispatch cell. */
export async function closeoutBookingAction(
  moUuid: string,
  bookingUuid: string,
  input: CloseBookingInput,
): Promise<CloseoutBookingResult> {
  const t = await token();
  if (!t) return unauthorized("closeoutBookingAction");

  const body: Record<string, unknown> = {
    remaining_qty: input.remaining_qty,
  };
  if (input.scanned_cell_uuid) body.scanned_cell_uuid = input.scanned_cell_uuid;
  if (input.photo_url) body.photo_url = input.photo_url;
  if (input.skip_photo_reason) body.skip_photo_reason = input.skip_photo_reason;

  try {
    const { booking } = await api<{ booking: ManufacturingOrderBooking }>(
      `/api/m/closeout/${encodeURIComponent(moUuid)}/bookings/${encodeURIComponent(bookingUuid)}`,
      { method: "POST", token: t, body: JSON.stringify(body) },
    );
    revalidatePath(`/m/closeout/${moUuid}`);
    revalidatePath("/m/closeout");
    return { ok: true, booking };
  } catch (err) {
    return toErrorResult(err, {
      source: "closeoutBookingAction",
      fallbackDetail: "Couldn't close out this booking.",
    });
  }
}

export interface CloseOutputInput {
  scanned_cell_uuid: string;
  /** Stock-movement photo. One of `photo_url` or `skip_photo_reason`
   *  must be set — gated by the closeout panel. */
  photo_url: string | null;
  skip_photo_reason: string | null;
}

/** Move a produced output lot off the production-feed cell to the
 *  scanned dispatch cell. */
export async function closeoutOutputLotAction(
  moUuid: string,
  lotUuid: string,
  input: CloseOutputInput,
): Promise<CloseoutOutputResult> {
  const t = await token();
  if (!t) return unauthorized("closeoutOutputLotAction");

  const body: Record<string, unknown> = {
    scanned_cell_uuid: input.scanned_cell_uuid,
  };
  if (input.photo_url) body.photo_url = input.photo_url;
  if (input.skip_photo_reason) body.skip_photo_reason = input.skip_photo_reason;

  try {
    const { lot } = await api<{ lot: { status: string } }>(
      `/api/m/closeout/${encodeURIComponent(moUuid)}/output-lots/${encodeURIComponent(lotUuid)}`,
      { method: "POST", token: t, body: JSON.stringify(body) },
    );
    revalidatePath(`/m/closeout/${moUuid}`);
    revalidatePath("/m/closeout");
    return { ok: true, lot };
  } catch (err) {
    return toErrorResult(err, {
      source: "closeoutOutputLotAction",
      fallbackDetail: "Couldn't hand off the output lot.",
    });
  }
}
