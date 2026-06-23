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
import type { ReturnPickRow } from "../production/types";

export interface PickToTrolleyInput {
  scanned_cell_uuid: string;
  photo_url: string | null;
}

export interface PlaceFromTrolleyInput {
  scanned_cell_uuid: string;
  photo_url: string | null;
  /** Required when no `photo_url` — mirrors the PO put-away contract. */
  skip_photo_reason: string | null;
}

export type PickResult =
  | { ok: true; pick: ReturnPickRow }
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

/** Scan a lot off a dispatch cell onto the worker's trolley. */
export async function pickReturnLotAction(
  lotUuid: string,
  input: PickToTrolleyInput,
): Promise<PickResult> {
  const t = await token();
  if (!t) return unauthorized("pickReturnLotAction");

  const body: Record<string, unknown> = {
    scanned_cell_uuid: input.scanned_cell_uuid,
  };
  if (input.photo_url) body.photo_url = input.photo_url;

  try {
    const { pick } = await api<{ pick: ReturnPickRow }>(
      `/api/m/return-pickup/lots/${encodeURIComponent(lotUuid)}/pick`,
      { method: "POST", token: t, body: JSON.stringify(body) },
    );
    revalidatePath("/m/return-pickup");
    return { ok: true, pick };
  } catch (err) {
    return toErrorResult(err, {
      source: "pickReturnLotAction",
      fallbackDetail: "Couldn't pick that lot onto the trolley.",
    });
  }
}

/** Place a trolley row's lot into a scanned warehouse cell. */
export async function placeReturnLotAction(
  pickUuid: string,
  input: PlaceFromTrolleyInput,
): Promise<PickResult> {
  const t = await token();
  if (!t) return unauthorized("placeReturnLotAction");

  const body: Record<string, unknown> = {
    scanned_cell_uuid: input.scanned_cell_uuid,
  };
  if (input.photo_url) body.photo_url = input.photo_url;
  if (input.skip_photo_reason) body.skip_photo_reason = input.skip_photo_reason;

  try {
    const { pick } = await api<{ pick: ReturnPickRow }>(
      `/api/m/return-pickup/picks/${encodeURIComponent(pickUuid)}/place`,
      { method: "POST", token: t, body: JSON.stringify(body) },
    );
    revalidatePath("/m/return-pickup");
    return { ok: true, pick };
  } catch (err) {
    return toErrorResult(err, {
      source: "placeReturnLotAction",
      fallbackDetail: "Couldn't place that lot.",
    });
  }
}

/** Drop a trolley row without placing the lot. */
export async function abortReturnPickAction(
  pickUuid: string,
): Promise<{ ok: true } | ErrorResult> {
  const t = await token();
  if (!t) return unauthorized("abortReturnPickAction");

  try {
    await api(`/api/m/return-pickup/picks/${encodeURIComponent(pickUuid)}/abort`, {
      method: "POST",
      token: t,
      body: JSON.stringify({}),
    });
    revalidatePath("/m/return-pickup");
    return { ok: true };
  } catch (err) {
    return toErrorResult(err, {
      source: "abortReturnPickAction",
      fallbackDetail: "Couldn't abort the trolley row.",
    });
  }
}
