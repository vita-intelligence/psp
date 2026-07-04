import type { AuditActor } from "../types";

export type ShipmentStatus = "draft" | "ready" | "picked_up" | "cancelled";

export interface ShipmentLotSummary {
  id: number;
  uuid: string;
  code: string | null;
  supplier_batch_no: string | null;
  qty_received: string | null;
  expiry_at: string | null;
  ownership_kind: "own" | "bailee";
  item: {
    id: number;
    uuid: string;
    name: string;
    item_type: string;
  } | null;
  unit_symbol: string | null;
  bailee_customer: { id: number; uuid: string; name: string } | null;
  placement: {
    cell_uuid: string;
    cell_name: string | null;
    cell_code: string | null;
    cell_purpose: string;
    location_name: string | null;
    location_code: string | null;
    floor_name: string | null;
    warehouse_name: string | null;
  } | null;
}

export interface Shipment {
  id: number;
  uuid: string;
  status: ShipmentStatus;
  qty: string;
  recipient_name: string | null;
  ship_to_address: string | null;
  ship_to_country: string | null;
  carrier: string | null;
  vehicle_registration: string | null;
  driver_name: string | null;
  consignment_note_ref: string | null;
  seal_number: string | null;
  temperature_c: string | null;
  planned_ship_at: string | null;
  notes: string | null;
  loading_photo_url: string | null;
  customer: {
    id: number;
    uuid: string;
    name: string;
    legal_name: string | null;
    contact_name: string | null;
    legal_address: string | null;
    country_code: string | null;
  } | null;
  customer_order: { id: number; uuid: string; status: string } | null;
  stock_lot: ShipmentLotSummary | null;
  created_at: string;
  created_by: AuditActor | null;
  ready_at: string | null;
  ready_by: AuditActor | null;
  picked_up_at: string | null;
  picked_up_by: AuditActor | null;
  cancelled_at: string | null;
  cancelled_by: AuditActor | null;
  cancel_reason: string | null;
  updated_at: string;
}

export interface ShipmentListResponse {
  items: Shipment[];
  next_cursor: string | null;
}

export interface ShipmentEditableFields {
  customer_id?: number | null;
  recipient_name?: string | null;
  ship_to_address?: string | null;
  ship_to_country?: string | null;
  carrier?: string | null;
  vehicle_registration?: string | null;
  driver_name?: string | null;
  consignment_note_ref?: string | null;
  seal_number?: string | null;
  temperature_c?: string | null;
  qty?: string;
  planned_ship_at?: string | null;
  notes?: string | null;
  loading_photo_url?: string | null;
}
