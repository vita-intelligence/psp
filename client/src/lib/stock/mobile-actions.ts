"use server";

import { api } from "../api";
import { getDeviceToken } from "../devices/server";
import {
  syntheticErrorResult,
  toErrorResult,
  type ErrorResult,
} from "../errors/server";

export type MoveLotResult = { ok: true } | ErrorResult;

export interface MoveLotInput {
  lotUuid: string;
  toCellUuid: string;
  qty?: string;
  photoUrl?: string | null;
  skipPhotoReason?: string | null;
  reason?: string | null;
}

/**
 * Mobile-side action: commit a put-away move. Auth flows over the
 * device bearer cookie (the phone has no laptop session).
 */
export async function moveLotAction(
  input: MoveLotInput,
): Promise<MoveLotResult> {
  const token = await getDeviceToken();
  if (!token)
    return syntheticErrorResult({
      source: "moveLotAction",
      code: "unauthorized",
      detail: "Device isn't signed in. Pair it again from your laptop.",
    });

  try {
    await api<{ lot: unknown }>(
      `/api/stock/lots/${encodeURIComponent(input.lotUuid)}/move`,
      {
        method: "POST",
        token,
        body: JSON.stringify({
          to_cell_uuid: input.toCellUuid,
          qty: input.qty,
          photo_url: input.photoUrl ?? null,
          skip_photo_reason: input.skipPhotoReason ?? null,
          reason: input.reason ?? null,
        }),
      },
    );
    return { ok: true };
  } catch (err) {
    return toErrorResult(err, {
      source: "moveLotAction",
      fallbackDetail: "Couldn't complete the move.",
    });
  }
}
