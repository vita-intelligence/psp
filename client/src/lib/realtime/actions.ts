"use server";

import { api } from "../api";
import { getSessionToken } from "../auth/server";
import { getDeviceToken } from "../devices/server";
import {
  syntheticErrorResult,
  toErrorResult,
  type ErrorResult,
} from "../errors/server";

// Pack-shaped payload the laptop listener uses to populate the print
// dialog. Mirrors `BackendWeb.PrintBridgeController.print_label/2`.
export interface SendQuarantineLabelInput {
  inspection_uuid: string;
  line_uuid: string;
  pack_index: number;
  pack_count: number;
  item_name: string;
  qty: string;
  uom_symbol: string | null;
  supplier_batch_no: string | null;
}

export type SendQuarantineLabelResult =
  | { ok: true }
  | (ErrorResult & { ok: false });

// Phone → laptop print bridge. The BE controller broadcasts a
// `print_label` event on the actor's `user:<uuid>` channel; the
// laptop's `<PrintBridgeListener />` (mounted in the root layout)
// catches it and pops the print-copies dialog pre-filled with this
// payload. Returns `ok: true` whether or not the laptop is currently
// connected — Phoenix.PubSub fires-and-forgets.
export async function sendQuarantineLabelAction(
  input: SendQuarantineLabelInput,
): Promise<SendQuarantineLabelResult> {
  const token = (await getDeviceToken()) ?? (await getSessionToken());
  if (!token) {
    return syntheticErrorResult({
      source: "sendQuarantineLabelAction",
      code: "unauthorized",
      detail: "Not signed in — pair the device or log in again.",
    });
  }
  try {
    await api<{ ok: true }>("/api/realtime/print-label", {
      method: "POST",
      token,
      body: JSON.stringify({ kind: "quarantine_pack", payload: input }),
    });
    return { ok: true };
  } catch (err) {
    return toErrorResult(err, {
      source: "sendQuarantineLabelAction",
      fallbackDetail: "Couldn't reach the laptop.",
    });
  }
}


// Regular lot label — same phone-to-laptop bridge as the quarantine
// pack action above, but keyed on the lot itself instead of an
// inspection pack. Fired from the mobile lot detail page (goods that
// have already passed inspection and are sitting on the pending-put-
// away shelf) so the operator can print the standard stock label
// from their laptop without walking back to it. Preview fields
// mirror the on-page identity card so the print dialog shows what
// the operator is about to print.
export interface SendStockLotLabelInput {
  lot_uuid: string;
  lot_code: string;
  item_name: string;
  qty: string;
  uom_symbol: string | null;
  supplier_batch_no: string | null;
}

export type SendStockLotLabelResult =
  | { ok: true }
  | (ErrorResult & { ok: false });

// 3PL dispatch label — the customer-scoped sticky the picker
// puts on the parcel at Move time and follows through every
// subsequent stage. Print bridge payload mirrors the row card
// so the laptop print dialog shows a preview.
export interface SendThreePlDispatchLabelInput {
  dispatch_uuid: string;
  customer_name: string | null;
  item_name: string | null;
  lot_code: string | null;
  qty: string;
  uom_symbol: string | null;
  reference: string | null;
}

export type SendThreePlDispatchLabelResult =
  | { ok: true }
  | (ErrorResult & { ok: false });

export async function sendThreePlDispatchLabelAction(
  input: SendThreePlDispatchLabelInput,
): Promise<SendThreePlDispatchLabelResult> {
  const token = (await getDeviceToken()) ?? (await getSessionToken());
  if (!token) {
    return syntheticErrorResult({
      source: "sendThreePlDispatchLabelAction",
      code: "unauthorized",
      detail: "Not signed in — pair the device or log in again.",
    });
  }
  try {
    await api<{ ok: true }>("/api/realtime/print-label", {
      method: "POST",
      token,
      body: JSON.stringify({ kind: "three_pl_dispatch", payload: input }),
    });
    return { ok: true };
  } catch (err) {
    return toErrorResult(err, {
      source: "sendThreePlDispatchLabelAction",
      fallbackDetail: "Couldn't reach the laptop.",
    });
  }
}


export async function sendStockLotLabelAction(
  input: SendStockLotLabelInput,
): Promise<SendStockLotLabelResult> {
  const token = (await getDeviceToken()) ?? (await getSessionToken());
  if (!token) {
    return syntheticErrorResult({
      source: "sendStockLotLabelAction",
      code: "unauthorized",
      detail: "Not signed in — pair the device or log in again.",
    });
  }
  try {
    await api<{ ok: true }>("/api/realtime/print-label", {
      method: "POST",
      token,
      body: JSON.stringify({ kind: "stock_lot", payload: input }),
    });
    return { ok: true };
  } catch (err) {
    return toErrorResult(err, {
      source: "sendStockLotLabelAction",
      fallbackDetail: "Couldn't reach the laptop.",
    });
  }
}
