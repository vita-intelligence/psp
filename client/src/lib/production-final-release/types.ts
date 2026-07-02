// Final Product Release (BRCGS Issue 9 § 5.6 Positive Release) —
// TS mirror of the BE payloads in `payloads.ex`.

export type FinalReleaseStatus =
  | "pending"
  | "released"
  | "on_hold"
  | "rejected";

export type FinalReleaseFileKind = "coa" | "bmr" | "micro" | "label_retain";

export const FINAL_RELEASE_FILE_KINDS: FinalReleaseFileKind[] = [
  "coa",
  "bmr",
  "micro",
  "label_retain",
];

export const FILE_KIND_LABEL: Record<FinalReleaseFileKind, string> = {
  coa: "Certificate of Analysis",
  bmr: "Batch Manufacturing Record",
  micro: "Micro / potency test report",
  label_retain: "Label proof + retain sample photo",
};

export interface FinalReleaseActor {
  id: number;
  uuid: string;
  name: string | null;
  email: string | null;
}

export interface FinalReleaseFileRow {
  uuid: string;
  kind: FinalReleaseFileKind;
  filename: string;
  mime: string;
  byte_size: number;
  uploaded_at: string;
  uploaded_by: FinalReleaseActor | null;
}

export interface FinalReleaseLotSummary {
  id: number;
  uuid: string;
  code: string | null;
  status: string;
  qty_received: string | null;
  expiry_at: string | null;
  item: { id: number; uuid: string; name: string; item_type: string } | null;
  placement: {
    cell_uuid: string;
    cell_name: string | null;
    cell_purpose: string;
    location: { uuid: string; name: string | null; code: string | null } | null;
    floor: { uuid: string; name: string | null } | null;
    warehouse: { uuid: string; name: string | null } | null;
  } | null;
}

export interface FinalReleaseMoSummary {
  id: number;
  uuid: string;
  code: string | null;
  quantity: string;
  status: string;
}

export interface FinalRelease {
  uuid: string;
  status: FinalReleaseStatus;
  notes: string | null;
  hold_reason: string | null;
  reject_reason: string | null;
  releaser_id: number | null;
  releaser: FinalReleaseActor | null;
  releaser_signed_at: string | null;
  approver_id: number | null;
  approver: FinalReleaseActor | null;
  approver_signed_at: string | null;
  finalized_at: string | null;
  finalized_by: FinalReleaseActor | null;
  manufacturing_order: FinalReleaseMoSummary | null;
  stock_lot: FinalReleaseLotSummary | null;
  files: FinalReleaseFileRow[];
  required_file_kinds: FinalReleaseFileKind[];
  inserted_at: string;
  updated_at: string;
}

export interface FinalReleaseQueueResponse {
  items: FinalRelease[];
}
