import type { AuditActor } from "../types";

/** Slim part summary the BOM payload embeds — same shape the
 *  receive form's item picker option carries (id + name + code +
 *  UoM). */
export interface BOMPartSummary {
  id: number;
  uuid: string;
  code: string | null;
  name: string;
  item_type: string;
  external_sku: string | null;
  stock_uom: {
    id: number;
    uuid: string;
    code: string | null;
    symbol: string;
    name: string;
  } | null;
}

export interface BOMUomCompact {
  id: number;
  uuid: string;
  code: string | null;
  symbol: string;
  name: string;
}

export interface BOMLine {
  id: number;
  uuid: string;
  bom_id: number;
  sort_order: number;
  qty: string;
  is_fixed: boolean;
  notes: string | null;
  part_id: number;
  part: BOMPartSummary | null;
  unit_of_measurement_id: number | null;
  unit_of_measurement: BOMUomCompact | null;
  /** Most recent `stock_lots.unit_cost` for this part within the
   *  company. Server-computed on the detail payload; `null` when no
   *  receipt has ever landed a cost. */
  average_unit_cost?: string | null;
}

export interface BOMVersion {
  id: number;
  uuid: string;
  version_no: number;
  notes: string | null;
  created_by: { id: number; uuid: string; name: string } | null;
  inserted_at: string;
}

export interface BOM {
  id: number;
  uuid: string;
  code: string | null;
  name: string;
  notes: string | null;
  is_primary: boolean;
  is_active: boolean;
  item_id: number;
  item: BOMPartSummary | null;
  lines: BOMLine[];
  /** Append-only history of saves on this BOM. The newest row is
   *  the current state; older rows offer one-click revert. */
  versions?: BOMVersion[];
  inserted_at: string;
  updated_at: string;
  created_by: AuditActor | null;
  updated_by: AuditActor | null;
}

export interface BOMSummary {
  id: number;
  uuid: string;
  code: string | null;
  name: string;
  is_primary: boolean;
  is_active: boolean;
  item: BOMPartSummary | null;
  created_by: AuditActor | null;
  updated_by: AuditActor | null;
  inserted_at: string;
  updated_at: string;
}

export interface BOMLedgerPage {
  items: BOMSummary[];
  next_cursor: string | null;
}

/** POST/PATCH /api/production/boms payload. Lines are sent as the
 *  complete current snapshot — backend replaces them wholesale. */
export interface BOMUpsertInput {
  item_id?: number;
  name?: string;
  notes?: string | null;
  is_active?: boolean;
  /** Optional operator-supplied note that explains *why* this save
   *  happened. Stored on the resulting `bom_versions` row so the
   *  history card reads "v3 — adjusted Vitamin C qty after vendor
   *  change". Empty / null is fine. */
  version_notes?: string | null;
  lines: Array<{
    part_id: number;
    qty: string;
    unit_of_measurement_id?: number | null;
    is_fixed?: boolean;
    notes?: string | null;
    sort_order?: number;
  }>;
}
