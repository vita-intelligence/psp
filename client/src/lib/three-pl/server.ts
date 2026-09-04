import { api } from "../api";
import { getSessionToken } from "../auth/server";
import { getDeviceToken } from "../devices/server";
import type {
  BaileeShipmentRow,
  PendingDispatch,
  PendingReturn,
  ThreePLInventoryResponse,
  ThreePLLotDetailResponse,
} from "./types";

async function anyToken(): Promise<string | null> {
  return (await getSessionToken()) ?? (await getDeviceToken());
}

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

/** Pending dispatches for the mobile picker queue — takes either a
 *  device token (mobile flow) or a session token (desktop lookup). */
export async function listPendingDispatches(): Promise<PendingDispatch[]> {
  const token = await anyToken();
  if (!token) return [];
  try {
    const res = await api<{ items: PendingDispatch[] }>(
      "/api/three-pl/dispatch-requests",
      { token, cache: "no-store" },
    );
    return res.items;
  } catch {
    return [];
  }
}

/** Tab 2 of the mobile 3PL hub — draft shipments that still owe a
 *  shipping-form review before Mark Ready. */
export async function listBaileeShipmentsNeedingPaperwork(): Promise<
  BaileeShipmentRow[]
> {
  const token = await anyToken();
  if (!token) return [];
  try {
    const res = await api<{ items: BaileeShipmentRow[] }>(
      "/api/three-pl/shipments/needing-paperwork",
      { token, cache: "no-store" },
    );
    return res.items;
  } catch {
    return [];
  }
}

/** Tab 3 of the mobile 3PL hub — ready / partially_picked
 *  shipments waiting on truck arrival. */
export async function listBaileeShipmentsAwaitingPickup(): Promise<
  BaileeShipmentRow[]
> {
  const token = await anyToken();
  if (!token) return [];
  try {
    const res = await api<{ items: BaileeShipmentRow[] }>(
      "/api/three-pl/shipments/awaiting-pickup",
      { token, cache: "no-store" },
    );
    return res.items;
  } catch {
    return [];
  }
}

/** Tab 3 of the mobile 3PL hub — bailee-flow shipments in transit,
 *  awaiting customer delivery confirmation. */
export async function listBaileeShipmentsInTransit(): Promise<
  BaileeShipmentRow[]
> {
  const token = await anyToken();
  if (!token) return [];
  try {
    const res = await api<{ items: BaileeShipmentRow[] }>(
      "/api/three-pl/shipments/in-transit",
      { token, cache: "no-store" },
    );
    return res.items;
  } catch {
    return [];
  }
}

/** Tab 5 of the mobile 3PL hub — return tasks (dispatches whose
 *  shipment was cancelled and now owe a walk-back to bailee). */
export async function listPendingReturns(): Promise<PendingReturn[]> {
  const token = await anyToken();
  if (!token) return [];
  try {
    const res = await api<{ items: PendingReturn[] }>(
      "/api/three-pl/returns",
      { token, cache: "no-store" },
    );
    return res.items;
  } catch {
    return [];
  }
}

/** Single return task — the mobile scan flow lands here after
 *  tapping a row on the Return tab. */
export async function getPendingReturn(
  uuid: string,
): Promise<PendingReturn | null> {
  const token = await anyToken();
  if (!token) return null;
  try {
    const res = await api<{ dispatch: PendingReturn }>(
      `/api/three-pl/returns/${encodeURIComponent(uuid)}`,
      { token, cache: "no-store" },
    );
    return res.dispatch;
  } catch {
    return null;
  }
}

/** Single pending dispatch — the scan flow lands here after tapping
 *  the row in the queue. */
export async function getPendingDispatch(
  uuid: string,
): Promise<PendingDispatch | null> {
  const token = await anyToken();
  if (!token) return null;
  try {
    const res = await api<{ dispatch: PendingDispatch }>(
      `/api/three-pl/dispatch-requests/${encodeURIComponent(uuid)}`,
      { token, cache: "no-store" },
    );
    return res.dispatch;
  } catch {
    return null;
  }
}
