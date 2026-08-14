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
   *  remaining_qty > 0 AND route_choice ≠ "keep_in_place"; null
   *  otherwise (fully consumed OR keep-in-place chosen). */
  scanned_cell_uuid: string | null;
  /** Stock-movement photo — REQUIRED (BRCGS 3.5.1 / FSSC 22000
   *  traceability). The closeout panel gates the submit CTA on
   *  ``photoUrl`` being set; the backend ``ensure_photo`` gate
   *  refuses the request otherwise. The former "or skip with a
   *  reason" escape hatch was retired — see the FE comment at the
   *  top of ``closeout-flow.tsx``. */
  photo_url: string | null;
  /** Operator-supplied routing decision for the LEFTOVER after
   *  partial consume. Only meaningful when ``remaining_qty > 0``:
   *  - `"auto"` / omitted — default. Move leftover to a scanned
   *    dispatch cell (current behaviour, warehouse eventually picks
   *    it back).
   *  - `"keep_in_place"` — leftover stays at the production feed
   *    cell. BE rejects with ``:not_reserved`` when no live
   *    downstream MO has the lot booked (would otherwise strand
   *    the ingredient at production with nothing coming to consume
   *    it).
   *  - `"send_to_warehouse"` — same as ``"auto"``, explicit form. */
  route_choice?: "auto" | "keep_in_place" | "send_to_warehouse";
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
  if (input.route_choice && input.route_choice !== "auto")
    body.route_choice = input.route_choice;

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
  /** Null when the output lot has a live downstream reservation AND
   *  the operator chose to keep it in place — the BE short-circuits
   *  and leaves the lot at the production-feed cell. Required
   *  otherwise (normal dispatch move). */
  scanned_cell_uuid: string | null;
  /** Stock-movement photo — REQUIRED (BRCGS 3.5.1 / FSSC 22000
   *  traceability). Gated by the closeout panel and by the BE
   *  ``ensure_photo`` check. Ignored (and may be null) on the
   *  keep-in-place path since nothing moves. */
  photo_url: string | null;
  /** Operator-supplied routing decision. Only meaningful for output
   *  lots that carry a live downstream reservation:
   *  - `"auto"` / omitted — default. Reserved → keep in place;
   *    otherwise dispatch move.
   *  - `"keep_in_place"` — explicit keep (rejected by BE if the lot
   *    isn't reserved).
   *  - `"send_to_warehouse"` — force the dispatch move even when
   *    reservations exist. Used when the operator wants the lot to
   *    leave production for QC hold / external inspection / any
   *    other reason not modelled here. */
  route_choice?: "auto" | "keep_in_place" | "send_to_warehouse";
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

  const body: Record<string, unknown> = {};
  if (input.scanned_cell_uuid)
    body.scanned_cell_uuid = input.scanned_cell_uuid;
  if (input.photo_url) body.photo_url = input.photo_url;
  if (input.route_choice && input.route_choice !== "auto")
    body.route_choice = input.route_choice;

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
