import { api } from "../api";
import { getSessionToken } from "../auth/server";
import { getDeviceToken } from "../devices/server";
import type {
  BaileeShipmentRow,
  DispatchAnyState,
  PendingDispatch,
  PendingReturn,
  ThreePLInventoryResponse,
  ThreePLListPage,
  ThreePLListParams,
  ThreePLLotDetailResponse,
} from "./types";

// Query-string builder for the paginated list endpoints — keeps the
// param serialisation (drop nils, trim empty strings) consistent so
// the server's cursor stays deterministic per (q, limit) combo.
function listQuery(params: ThreePLListParams | undefined): string {
  if (!params) return "";
  const search = new URLSearchParams();
  const q = params.q?.trim();
  if (q) search.set("q", q);
  if (params.cursor) search.set("cursor", params.cursor);
  if (params.limit) search.set("limit", String(params.limit));
  const s = search.toString();
  return s ? `?${s}` : "";
}

// Empty-page fallback for the silent-degrade path (no token, network
// hiccup). Keeps the tab renderers unconditional — an unauthenticated
// or offline mobile just gets an empty list, not a stack trace.
const EMPTY_PAGE: ThreePLListPage<never> = {
  items: [],
  next_cursor: null,
};

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

/** Pending dispatches for the mobile picker queue — paginated with
 *  optional case-insensitive search across item name / lot code /
 *  bailee customer / operator reference. */
export async function listPendingDispatches(
  params?: ThreePLListParams,
): Promise<ThreePLListPage<PendingDispatch>> {
  const token = await anyToken();
  if (!token) return EMPTY_PAGE;
  try {
    return await api<ThreePLListPage<PendingDispatch>>(
      `/api/three-pl/dispatch-requests${listQuery(params)}`,
      { token, cache: "no-store" },
    );
  } catch {
    return EMPTY_PAGE;
  }
}

/** Tab 2 of the mobile 3PL hub — draft shipments that still owe a
 *  shipping-form review before Mark Ready. */
export async function listBaileeShipmentsNeedingPaperwork(
  params?: ThreePLListParams,
): Promise<ThreePLListPage<BaileeShipmentRow>> {
  const token = await anyToken();
  if (!token) return EMPTY_PAGE;
  try {
    return await api<ThreePLListPage<BaileeShipmentRow>>(
      `/api/three-pl/shipments/needing-paperwork${listQuery(params)}`,
      { token, cache: "no-store" },
    );
  } catch {
    return EMPTY_PAGE;
  }
}

/** Tab 3 of the mobile 3PL hub — ready / partially_picked
 *  shipments waiting on truck arrival. */
export async function listBaileeShipmentsAwaitingPickup(
  params?: ThreePLListParams,
): Promise<ThreePLListPage<BaileeShipmentRow>> {
  const token = await anyToken();
  if (!token) return EMPTY_PAGE;
  try {
    return await api<ThreePLListPage<BaileeShipmentRow>>(
      `/api/three-pl/shipments/awaiting-pickup${listQuery(params)}`,
      { token, cache: "no-store" },
    );
  } catch {
    return EMPTY_PAGE;
  }
}

/** Tab 4 of the mobile 3PL hub — bailee-flow shipments in transit,
 *  awaiting customer delivery confirmation. */
export async function listBaileeShipmentsInTransit(
  params?: ThreePLListParams,
): Promise<ThreePLListPage<BaileeShipmentRow>> {
  const token = await anyToken();
  if (!token) return EMPTY_PAGE;
  try {
    return await api<ThreePLListPage<BaileeShipmentRow>>(
      `/api/three-pl/shipments/in-transit${listQuery(params)}`,
      { token, cache: "no-store" },
    );
  } catch {
    return EMPTY_PAGE;
  }
}

/** Tab 5 of the mobile 3PL hub — return tasks (dispatches whose
 *  shipment was cancelled and now owe a walk-back to bailee). */
export async function listPendingReturns(
  params?: ThreePLListParams,
): Promise<ThreePLListPage<PendingReturn>> {
  const token = await anyToken();
  if (!token) return EMPTY_PAGE;
  try {
    return await api<ThreePLListPage<PendingReturn>>(
      `/api/three-pl/returns${listQuery(params)}`,
      { token, cache: "no-store" },
    );
  } catch {
    return EMPTY_PAGE;
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

/** Fetch a dispatch regardless of lifecycle state — powers the
 *  printable-label endpoint (a dispatch might need re-printing
 *  at any stage) and the scan-to-open resolver. Includes a slim
 *  linked-shipment summary so the resolver can route completed
 *  dispatches to the exact /m/shipments/:uuid page. */
export async function getDispatchAnyState(
  uuid: string,
): Promise<DispatchAnyState | null> {
  const token = await anyToken();
  if (!token) return null;
  try {
    const res = await api<{ dispatch: DispatchAnyState }>(
      `/api/three-pl/dispatches/${encodeURIComponent(uuid)}`,
      { token, cache: "no-store" },
    );
    return res.dispatch;
  } catch {
    return null;
  }
}
