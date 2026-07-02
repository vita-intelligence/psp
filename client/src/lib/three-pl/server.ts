import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type {
  ThreePLInventoryResponse,
  ThreePLLotDetailResponse,
} from "./types";

/** Bailee-custody inventory for the /three-pl tab. Guarded by
 *  `production.final_release` on the backend — a viewer without the
 *  permission gets an empty list rather than a 403. */
export async function getThreePLInventory(): Promise<ThreePLInventoryResponse | null> {
  const token = await getSessionToken();
  if (!token) return null;
  try {
    return await api<ThreePLInventoryResponse>("/api/three-pl/inventory", {
      token,
    });
  } catch {
    return null;
  }
}

/** Full detail bundle for the /three-pl/[lot_uuid] item page —
 *  lot + paperwork (CoA / BMR / micro / label proof / retain sample)
 *  + dispatch history + summary stats. */
export async function getThreePLLotDetail(
  lotUuid: string,
): Promise<ThreePLLotDetailResponse | null> {
  const token = await getSessionToken();
  if (!token) return null;
  try {
    return await api<ThreePLLotDetailResponse>(
      `/api/three-pl/lots/${encodeURIComponent(lotUuid)}`,
      { token },
    );
  } catch {
    return null;
  }
}
