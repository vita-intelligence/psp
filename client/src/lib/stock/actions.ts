"use server";

import { revalidatePath } from "next/cache";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { StockLot, StockMovement, ComplianceState } from "../types";
import {
  toErrorResult,
  unauthorizedResult,
  type ErrorResult,
} from "../errors/server";

export type CreateManualLotResult =
  | { ok: true; lot: StockLot }
  | ErrorResult;

export interface ManualLotInput {
  item_id: number;
  unit_of_measurement_id: number;
  /** Destination warehouse. The lot lands in the warehouse's auto-
   *  managed Unregistered cell — the operator scan-moves it later
   *  once they know the actual shelf. We deliberately don't take a
   *  cell id from the operator on receive: nobody knows the exact
   *  shelf at the moment a pallet rolls in. */
  warehouse_id: number;
  /** Total quantity landed, as a decimal string. */
  qty_received: string;
  // Per-lot packaging (mandatory). Lengths in millimetres so they're
  // integer-safe; weight in kg as a decimal string.
  package_length_mm: number;
  package_width_mm: number;
  package_height_mm: number;
  package_weight_kg: string;
  units_per_package: number;
  stack_factor: number;
  // optional metadata. `source_kind` is forced to "manual" by the
  // backend — callers don't need to send it.
  unit_cost?: string | null;
  currency?: string | null;
  supplier_batch_no?: string | null;
  country_of_origin?: string | null;
  revision?: string | null;
  manufactured_at?: string | null;
  expiry_at?: string | null;
  available_from?: string | null;
  overall_risk?: "low" | "medium" | "high" | null;
  allergen_status?: ComplianceState | null;
  coa_status?: ComplianceState | null;
  quality_status?: ComplianceState | null;
  notes?: string | null;
}

/**
 * Create a manual lot — for ad-hoc stock entry (opening balances,
 * adjustments). The backend records `source_kind: "manual"` and
 * the actor's `created_by`. Real receives against a Purchase Order
 * land later via the procurement module.
 *
 * POST /api/stock/lots/manual inserts lot + initial placement +
 * receive movement in one transaction; the list cache is
 * invalidated so the new lot shows up immediately.
 */
export async function createManualLotAction(
  input: ManualLotInput,
): Promise<CreateManualLotResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("createManualLotAction");

  try {
    const res = await api<{ lot: StockLot }>(
      "/api/stock/lots/manual",
      { method: "POST", token, body: JSON.stringify(input) },
    );
    revalidatePath("/stock/lots");
    return { ok: true, lot: res.lot };
  } catch (err) {
    return toErrorResult(err, {
      source: "createManualLotAction",
      fallbackDetail: "Couldn't create the lot.",
    });
  }
}

/** One pack within a bulk manual receive. Carries its own qty +
 *  packaging dims + supplier batch override; everything else
 *  (item, warehouse, identity, currency, …) comes from the
 *  `BulkManualLotInput` it sits inside. */
export interface ManualLotPack {
  qty_received: string;
  package_length_mm: number;
  package_width_mm: number;
  package_height_mm: number;
  package_weight_kg: string;
  units_per_package: number;
  stack_factor: number;
  supplier_batch_no?: string | null;
}

/** Bulk manual receive shape. Mirrors {@link ManualLotInput} but the
 *  packaging fields move into a `packs: [...]` array so one delivery
 *  can land as N stock lots of different sizes — same model as the
 *  PO receive flow's per-pack split. */
export interface BulkManualLotInput {
  item_id: number;
  unit_of_measurement_id: number;
  warehouse_id: number;
  packs: ManualLotPack[];
  unit_cost?: string | null;
  currency?: string | null;
  supplier_batch_no?: string | null;
  country_of_origin?: string | null;
  revision?: string | null;
  manufactured_at?: string | null;
  expiry_at?: string | null;
  available_from?: string | null;
  overall_risk?: "low" | "medium" | "high" | null;
  allergen_status?: ComplianceState | null;
  coa_status?: ComplianceState | null;
  quality_status?: ComplianceState | null;
  notes?: string | null;
}

export type BulkManualLotResult =
  | { ok: true; lots: StockLot[] }
  | (ErrorResult & { pack_index?: number });

/**
 * Bulk variant of {@link createManualLotAction} — one delivery, mixed
 * packaging, all-or-nothing. Each `packs[i]` becomes one stock_lot;
 * on validation failure the response carries the failing pack's
 * `pack_index` so the FE can scroll/highlight the right row.
 */
export async function createManualLotBulkAction(
  input: BulkManualLotInput,
): Promise<BulkManualLotResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("createManualLotBulkAction");

  try {
    const res = await api<{ lots: StockLot[] }>(
      "/api/stock/lots/manual-bulk",
      { method: "POST", token, body: JSON.stringify(input) },
    );
    revalidatePath("/stock/lots");
    return { ok: true, lots: res.lots };
  } catch (err) {
    const base = toErrorResult(err, {
      source: "createManualLotBulkAction",
      fallbackDetail: "Couldn't create the lots.",
    });
    // `extras.pack_index` is set by the BE on per-pack validation
    // failures so the FE can route the error to the right row.
    const packIndex =
      typeof (err as { extras?: { pack_index?: unknown } })?.extras
        ?.pack_index === "number"
        ? ((err as { extras: { pack_index: number } }).extras.pack_index)
        : undefined;
    return { ...base, ...(packIndex !== undefined ? { pack_index: packIndex } : {}) };
  }
}

/** Subset of `StockLot` fields the edit form is allowed to send.
 *  The backend changeset re-validates everything; the type just
 *  documents the contract so the form can't ship a typo'd key. */
export interface UpdateLotInput {
  status?: StockLot["status"];
  unit_cost?: string | null;
  currency?: string | null;
  source_kind?: StockLot["source_kind"];
  source_ref?: string | null;
  supplier_batch_no?: string | null;
  country_of_origin?: string | null;
  revision?: string | null;
  manufactured_at?: string | null;
  expiry_at?: string | null;
  available_from?: string | null;
  notes?: string | null;
  overall_risk?: "low" | "medium" | "high" | null;
  allergen_status?: ComplianceState | null;
  coa_status?: ComplianceState | null;
  quality_status?: ComplianceState | null;
  package_length_mm?: number;
  package_width_mm?: number;
  package_height_mm?: number;
  package_weight_kg?: string;
  units_per_package?: number;
  stack_factor?: number;
}

export type UpdateLotResult =
  | { ok: true; lot: StockLot; movements: StockMovement[] }
  | ErrorResult;

export interface AdjustLotInput {
  /** Optional: which placement to adjust. Defaults backend-side to the
   *  single non-zero placement when only one exists. */
  from_cell_uuid?: string;
  /** Signed decimal string. Positive = adjust_up, negative =
   *  adjust_down. Non-zero. */
  delta_qty: string;
  /** Free text — required so the audit row is meaningful. */
  reason: string;
}

export type AdjustLotResult =
  | { ok: true; lot: StockLot; movements: StockMovement[] }
  | ErrorResult;

/**
 * POST /api/stock/lots/:uuid/adjust — manual qty adjustment. Records
 * an adjust_up / adjust_down movement carrying the operator's reason.
 */
export async function adjustLotAction(
  uuid: string,
  input: AdjustLotInput,
): Promise<AdjustLotResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("adjustLotAction");

  try {
    const res = await api<{ lot: StockLot; movements: StockMovement[] }>(
      `/api/stock/lots/${encodeURIComponent(uuid)}/adjust`,
      { method: "POST", token, body: JSON.stringify(input) },
    );
    revalidatePath("/stock/lots");
    revalidatePath(`/stock/lots/${uuid}`);
    return { ok: true, lot: res.lot, movements: res.movements };
  } catch (err) {
    return toErrorResult(err, {
      source: "adjustLotAction",
      fallbackDetail: "Couldn't adjust the lot.",
    });
  }
}

export interface MoveLotInput {
  to_cell_uuid: string;
  /** Optional: when the lot is split across multiple cells the
   *  operator picks which one to pull from. Defaults to the only
   *  non-zero placement when there's just one. */
  from_cell_uuid?: string;
  /** Decimal string. Defaults backend-side to the source placement's
   *  on-hand. */
  qty?: string;
  /** URL returned by the movement-photos upload. */
  photo_url?: string | null;
  /** Reason recorded when no photo is attached. */
  skip_photo_reason?: string | null;
}

export type MoveLotResult =
  | { ok: true; lot: StockLot }
  | ErrorResult;

/**
 * POST /api/stock/lots/:uuid/move — laptop-side move. Mirrors the
 * mobile flow but driven by a typed cell picker instead of a QR
 * scan. The backend records the same `move` movement either way.
 */
export async function moveLotAction(
  uuid: string,
  input: MoveLotInput,
): Promise<MoveLotResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("moveLotAction");

  try {
    const res = await api<{ lot: StockLot }>(
      `/api/stock/lots/${encodeURIComponent(uuid)}/move`,
      { method: "POST", token, body: JSON.stringify(input) },
    );
    revalidatePath("/stock/lots");
    revalidatePath(`/stock/lots/${uuid}`);
    return { ok: true, lot: res.lot };
  } catch (err) {
    return toErrorResult(err, {
      source: "moveLotAction",
      fallbackDetail: "Couldn't move the lot.",
    });
  }
}

/**
 * PATCH /api/stock/lots/:uuid — identity + packaging edit. Returns
 * the freshly preloaded lot so the page can re-render without a
 * follow-up GET. Revalidates both the list and the detail page.
 */
export async function updateLotAction(
  uuid: string,
  input: UpdateLotInput,
): Promise<UpdateLotResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("updateLotAction");

  try {
    const res = await api<{ lot: StockLot; movements: StockMovement[] }>(
      `/api/stock/lots/${encodeURIComponent(uuid)}`,
      { method: "PATCH", token, body: JSON.stringify(input) },
    );
    revalidatePath("/stock/lots");
    revalidatePath(`/stock/lots/${uuid}`);
    return { ok: true, lot: res.lot, movements: res.movements };
  } catch (err) {
    return toErrorResult(err, {
      source: "updateLotAction",
      fallbackDetail: "Couldn't save the lot.",
    });
  }
}
