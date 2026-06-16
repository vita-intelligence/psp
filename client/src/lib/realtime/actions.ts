"use server";

import { api } from "../api";
import { getSessionToken } from "../auth/server";
import { getDeviceToken } from "../devices/server";
import { toErrorResult, type ErrorResult } from "../errors/server";

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
    return {
      ok: false,
      detail: "Not signed in — pair the device or log in again.",
      code: "unauthorized",
    };
  }
  try {
    await api<{ ok: true }>("/api/realtime/print-label", {
      method: "POST",
      token,
      body: JSON.stringify({ kind: "quarantine_pack", payload: input }),
    });
    return { ok: true };
  } catch (err) {
    return {
      ...toErrorResult(err, {
        source: "sendQuarantineLabelAction",
        fallbackDetail: "Couldn't reach the laptop.",
      }),
      ok: false,
    };
  }
}
