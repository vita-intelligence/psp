import { api } from "../api";
import { getSessionToken } from "../auth/server";
import { getDeviceToken } from "../devices/server";
import type { FinalRelease, FinalReleaseQueueResponse } from "./types";

async function token(): Promise<string | null> {
  return (await getSessionToken()) ?? (await getDeviceToken());
}

/** Fetch (or lazily create) the release row for the given output lot. */
export async function getFinalReleaseByLot(
  lotUuid: string,
): Promise<FinalRelease | null> {
  const t = await token();
  if (!t) return null;
  try {
    const { release } = await api<{ release: FinalRelease }>(
      `/api/production/final-releases/by-lot/${encodeURIComponent(lotUuid)}`,
      { token: t },
    );
    return release;
  } catch {
    return null;
  }
}

/** Pending-release queue for both desktop + mobile tiles. */
export async function getFinalReleaseQueue(): Promise<FinalReleaseQueueResponse | null> {
  const t = await token();
  if (!t) return null;
  try {
    return await api<FinalReleaseQueueResponse>(
      `/api/production/final-releases/queue`,
      { token: t },
    );
  } catch {
    return null;
  }
}
