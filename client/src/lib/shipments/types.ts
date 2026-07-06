import type { AuditActor } from "../types";

export type ShipmentStatus =
  | "draft"
  | "ready"
  | "picked_up"
  | "delivered"
  | "cancelled";

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
  /** Dispatch-cell dwell + estimated storage cost. `null` when the
   *  lot has never landed in a dispatch cell. Rate is the company's
   *  3PL storage rate reused as a proxy for own-stock carrying cost. */
  dispatch_dwell: {
    arrived_at: string;
    dwell_seconds: number;
    volume_m3: string | null;
    /** `null` when the company hasn't set a 3PL rate. */
    estimated_storage_cost: string | null;
    rate_per_m3_per_day: string | null;
  } | null;
  // Truck-arrival checklist (BRCGS Issue 9 § 5.4.6). Nullable until
  // the operator fills the mobile dispatch form.
  packaging_intact: boolean | null;
  labels_verified: boolean | null;
  vehicle_clean_suitable: boolean | null;
  transport_condition_acceptable: boolean | null;
  dispatch_approved: boolean | null;
  pickup_files: ShipmentPickupFile[];
  // Delivery confirmation — filled by the customer-facing team once
  // the POD comes back. Nullable until then; `delivered_at` set on
  // the transition to `picked_up → delivered`.
  delivered_at: string | null;
  delivered_by: AuditActor | null;
  recipient_signatory: string | null;
  delivery_notes: string | null;
  delivery_files: ShipmentDeliveryFile[];
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

export interface ShipmentDeliveryFile {
  uuid: string;
  filename: string;
  mime: string;
  byte_size: number;
  uploaded_at: string;
  uploaded_by: { uuid: string; name: string } | null;
  url: string;
}

export interface ShipmentDeliveryPayload {
  recipient_signatory: string;
  delivery_notes?: string | null;
  delivered_at?: string | null;
}

export interface ShipmentPickupFile {
  uuid: string;
  filename: string;
  mime: string;
  byte_size: number;
  uploaded_at: string;
  uploaded_by: { uuid: string; name: string } | null;
  url: string;
}

export interface ShipmentPickupChecklist {
  carrier: string;
  vehicle_registration: string;
  packaging_intact: boolean;
  labels_verified: boolean;
  vehicle_clean_suitable: boolean;
  transport_condition_acceptable: boolean;
  dispatch_approved: boolean;
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
