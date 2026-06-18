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

async function pickupToken(source: string) {
  const token = (await getDeviceToken()) ?? (await getSessionToken());
  if (!token) {
    return {
      err: syntheticErrorResult({
        source,
        code: "unauthorized",
        detail: "Device isn't signed in. Pair it again from your laptop.",
      }),
    };
  }
  return { token };
}

/** Head-of-picker lock — claims the MO for this operator. */
export async function startMoPickupAction(
  moUuid: string,
): Promise<PickupMoResult> {
  const t = await pickupToken("startMoPickupAction");
  if ("err" in t) return { ok: false, ...t.err };
  try {
    const { mo } = await api<{ mo: ManufacturingOrder }>(
      `/api/m/pickup/${encodeURIComponent(moUuid)}/start`,
      { method: "POST", token: t.token, body: JSON.stringify({}) },
    );
    revalidatePath(`/m/pickup/${moUuid}`);
    revalidatePath(`/m/pickup`);
    return { ok: true, mo };
  } catch (err) {
    return {
      ok: false,
      ...toErrorResult(err, {
        source: "startMoPickupAction",
        fallbackDetail: "Couldn't start pickup.",
      }),
    };
  }
}

/** Picker scanned the cell + lot for a booking — stamps picked_at. */
export async function markBookingPickedAction(
  moUuid: string,
  bookingUuid: string,
  scannedLotUuid: string,
  scannedCellUuid: string,
): Promise<PickupBookingResult> {
  const t = await pickupToken("markBookingPickedAction");
  if ("err" in t) return { ok: false, ...t.err };
  try {
    const { booking } = await api<{ booking: ManufacturingOrderBooking }>(
      `/api/m/pickup/${encodeURIComponent(moUuid)}/bookings/${encodeURIComponent(bookingUuid)}/mark-picked`,
      {
        method: "POST",
        token: t.token,
        body: JSON.stringify({
          scanned_lot_uuid: scannedLotUuid,
          scanned_cell_uuid: scannedCellUuid,
        }),
      },
    );
    return { ok: true, booking };
  } catch (err) {
    return {
      ok: false,
      ...toErrorResult(err, {
        source: "markBookingPickedAction",
        fallbackDetail: "Couldn't mark booking as picked.",
      }),
    };
  }
}

/** Clears all picked_at + the MO's pickup_started_*. */
export async function abortMoPickupAction(
  moUuid: string,
): Promise<PickupMoResult> {
  const t = await pickupToken("abortMoPickupAction");
  if ("err" in t) return { ok: false, ...t.err };
  try {
    const { mo } = await api<{ mo: ManufacturingOrder }>(
      `/api/m/pickup/${encodeURIComponent(moUuid)}/abort`,
      { method: "POST", token: t.token, body: JSON.stringify({}) },
    );
    revalidatePath(`/m/pickup/${moUuid}`);
    revalidatePath(`/m/pickup`);
    return { ok: true, mo };
  } catch (err) {
    return {
      ok: false,
      ...toErrorResult(err, {
        source: "abortMoPickupAction",
        fallbackDetail: "Couldn't abort pickup.",
      }),
    };
  }
}

/** Final transfer — emits Stock.Movement per booking, stamps pickup_completed_*. */
export async function confirmPickupTransferAction(
  moUuid: string,
  productionCellUuid: string,
  photoUrlsByBookingUuid: Record<string, string>,
): Promise<PickupMoResult> {
  const t = await pickupToken("confirmPickupTransferAction");
  if ("err" in t) return { ok: false, ...t.err };
  try {
    const { mo } = await api<{ mo: ManufacturingOrder }>(
      `/api/m/pickup/${encodeURIComponent(moUuid)}/confirm-transfer`,
      {
        method: "POST",
        token: t.token,
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
    return {
      ok: false,
      ...toErrorResult(err, {
        source: "confirmPickupTransferAction",
        fallbackDetail: "Couldn't complete the transfer.",
      }),
    };
  }
}
