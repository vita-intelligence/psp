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


/** Phone → laptop navigate bridge input. Mirrors
 *  ``BackendWeb.PrintBridgeController.open_url/2``. */
export interface SendOpenUrlInput {
  /** Absolute same-origin path — validated server-side (must start
   *  with ``/``, no ``://``, no ``..``, no protocol-relative ``//``).
   *  Passing anything else returns ``unsafe_path``. */
  path: string;
  /** Optional short human label surfaced on the laptop's confirmation
   *  dialog so the user recognises what's about to open. Truncated to
   *  120 chars server-side. */
  title?: string;
}

export type SendOpenUrlResult =
  | { ok: true }
  | (ErrorResult & { ok: false });

/**
 * Phone → laptop URL bridge. Broadcasts an ``open_url`` event on the
 * actor's ``user:<uuid>`` channel; the laptop's PrintBridgeListener
 * catches it and pops a "From <actor>: open <title>?" dialog with a
 * single Open button that navigates the current laptop tab.
 *
 * Used by the mobile QC review to bounce the reviewer to the desktop
 * inspection detail page — that's where the editable QC surface
 * lives, so a single-field correction doesn't require typing on the
 * phone or copy-pasting a URL.
 *
 * Returns ``ok: true`` whether or not the laptop is currently
 * connected (Phoenix.PubSub is fire-and-forget). The mobile FE
 * should still surface a "Sent — check your desktop" toast and
 * offer a copy-link fallback for the "laptop isn't logged in"
 * case.
 */
export async function sendOpenUrlAction(
  input: SendOpenUrlInput,
): Promise<SendOpenUrlResult> {
  const token = (await getDeviceToken()) ?? (await getSessionToken());
  if (!token) {
    return syntheticErrorResult({
      source: "sendOpenUrlAction",
      code: "unauthorized",
      detail: "Not signed in — pair the device or log in again.",
    });
  }
  try {
    await api<{ ok: true }>("/api/realtime/open-url", {
      method: "POST",
      token,
      body: JSON.stringify(input),
    });
    return { ok: true };
  } catch (err) {
    return toErrorResult(err, {
      source: "sendOpenUrlAction",
      fallbackDetail: "Couldn't reach the laptop.",
    });
  }
}
