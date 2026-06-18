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
  ManufacturingOrder,
  ManufacturingOrderBooking,
} from "../production/types";

export type PickupMoResult =
  | { ok: true; mo: ManufacturingOrder }
  | (ErrorResult & { ok: false });

export type PickupBookingResult =
  | { ok: true; booking: ManufacturingOrderBooking }
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

/** Head-of-picker lock — claims the MO for this operator. */
export async function startMoPickupAction(
  moUuid: string,
): Promise<PickupMoResult> {
  const t = await token();
  if (!t) return unauthorized("startMoPickupAction");
  try {
    const { mo } = await api<{ mo: ManufacturingOrder }>(
      `/api/m/pickup/${encodeURIComponent(moUuid)}/start`,
      { method: "POST", token: t, body: JSON.stringify({}) },
    );
    revalidatePath(`/m/pickup/${moUuid}`);
    revalidatePath(`/m/pickup`);
    return { ok: true, mo };
  } catch (err) {
    return toErrorResult(err, {
      source: "startMoPickupAction",
      fallbackDetail: "Couldn't start pickup.",
    });
  }
}

/** Picker scanned the cell + lot for a booking — stamps picked_at. */
export async function markBookingPickedAction(
  moUuid: string,
  bookingUuid: string,
  scannedLotUuid: string,
  scannedCellUuid: string,
): Promise<PickupBookingResult> {
  const t = await token();
  if (!t) return unauthorized("markBookingPickedAction");
  try {
    const { booking } = await api<{ booking: ManufacturingOrderBooking }>(
      `/api/m/pickup/${encodeURIComponent(moUuid)}/bookings/${encodeURIComponent(bookingUuid)}/mark-picked`,
      {
        method: "POST",
        token: t,
        body: JSON.stringify({
          scanned_lot_uuid: scannedLotUuid,
          scanned_cell_uuid: scannedCellUuid,
        }),
      },
    );
    return { ok: true, booking };
  } catch (err) {
    return toErrorResult(err, {
      source: "markBookingPickedAction",
      fallbackDetail: "Couldn't mark booking as picked.",
    });
  }
}

/** Clears all picked_at + the MO's pickup_started_*. */
export async function abortMoPickupAction(
  moUuid: string,
): Promise<PickupMoResult> {
  const t = await token();
  if (!t) return unauthorized("abortMoPickupAction");
  try {
    const { mo } = await api<{ mo: ManufacturingOrder }>(
      `/api/m/pickup/${encodeURIComponent(moUuid)}/abort`,
      { method: "POST", token: t, body: JSON.stringify({}) },
    );
    revalidatePath(`/m/pickup/${moUuid}`);
    revalidatePath(`/m/pickup`);
    return { ok: true, mo };
  } catch (err) {
    return toErrorResult(err, {
      source: "abortMoPickupAction",
      fallbackDetail: "Couldn't abort pickup.",
    });
  }
}

/** Final transfer — emits Stock.Movement per booking, stamps pickup_completed_*. */
export async function confirmPickupTransferAction(
  moUuid: string,
  productionCellUuid: string,
  photoUrlsByBookingUuid: Record<string, string>,
): Promise<PickupMoResult> {
  const t = await token();
  if (!t) return unauthorized("confirmPickupTransferAction");
  try {
    const { mo } = await api<{ mo: ManufacturingOrder }>(
      `/api/m/pickup/${encodeURIComponent(moUuid)}/confirm-transfer`,
      {
        method: "POST",
        token: t,
        body: JSON.stringify({
          production_cell_uuid: productionCellUuid,
          photo_urls_by_booking_uuid: photoUrlsByBookingUuid,
        }),
      },
    );
    revalidatePath(`/m/pickup/${moUuid}`);
    revalidatePath(`/m/pickup`);
    return { ok: true, mo };
  } catch (err) {
    return toErrorResult(err, {
      source: "confirmPickupTransferAction",
      fallbackDetail: "Couldn't complete the transfer.",
    });
  }
}
