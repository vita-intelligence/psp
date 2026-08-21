"use server";

import { revalidatePath } from "next/cache";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import { getDeviceToken } from "../devices/server";
import {
  syntheticErrorResult,
  toErrorResult,
  type ErrorResult,
} from "../errors/server";
import type {
  Shipment,
  ShipmentCarrierEditableFields,
  ShipmentEditableFields,
} from "./types";

export type ShipmentResult =
  | { ok: true; shipment: Shipment }
  | (ErrorResult & { ok: false });

async function token(): Promise<string | null> {
  return (await getSessionToken()) ?? (await getDeviceToken());
}

function unauthorized(source: string): ErrorResult {
  return syntheticErrorResult({
    source,
    code: "unauthorized",
    detail: "Sign in to continue.",
  });
}

function invalidate(shipmentUuid?: string) {
  revalidatePath("/shipments");
  if (shipmentUuid) revalidatePath(`/shipments/${shipmentUuid}`);
}

/**
 * Create a draft shipment from a lot uuid. Used by both the desktop
 * /shipments/new redirect path and the mobile scan flow.
 */
export async function createShipmentAction(
  lotUuid: string,
): Promise<ShipmentResult> {
  const t = await token();
  if (!t) return unauthorized("createShipmentAction");

  try {
    const { shipment } = await api<{ shipment: Shipment }>(
      "/api/shipments",
      {
        method: "POST",
        token: t,
        body: JSON.stringify({ lot_uuid: lotUuid }),
      },
    );
    invalidate(shipment.uuid);
    return { ok: true, shipment };
  } catch (err) {
    return toErrorResult(err, {
      source: "createShipmentAction",
      fallbackDetail: "Couldn't create the shipment.",
    });
  }
}

export async function updateShipmentAction(
  uuid: string,
  fields: ShipmentEditableFields,
): Promise<ShipmentResult> {
  const t = await token();
  if (!t) return unauthorized("updateShipmentAction");

  try {
    const { shipment } = await api<{ shipment: Shipment }>(
      `/api/shipments/${encodeURIComponent(uuid)}`,
      { method: "PATCH", token: t, body: JSON.stringify(fields) },
    );
    invalidate(shipment.uuid);
    return { ok: true, shipment };
  } catch (err) {
    return toErrorResult(err, {
      source: "updateShipmentAction",
      fallbackDetail: "Couldn't save the shipment.",
    });
  }
}

/**
 * Post-pickup-safe carrier-paperwork edit. Talks to
 * ``PATCH /shipments/:uuid/carrier-details``. Perm gate is
 * state-dependent server-side: ``shipments.edit`` when draft/ready,
 * ``shipments.pickup`` when picked_up. Rejected in delivered /
 * cancelled.
 */
export async function updateShipmentCarrierDetailsAction(
  uuid: string,
  fields: ShipmentCarrierEditableFields,
): Promise<ShipmentResult> {
  const t = await token();
  if (!t) return unauthorized("updateShipmentCarrierDetailsAction");

  try {
    const { shipment } = await api<{ shipment: Shipment }>(
      `/api/shipments/${encodeURIComponent(uuid)}/carrier-details`,
      { method: "PATCH", token: t, body: JSON.stringify(fields) },
    );
    invalidate(shipment.uuid);
    return { ok: true, shipment };
  } catch (err) {
    return toErrorResult(err, {
      source: "updateShipmentCarrierDetailsAction",
      fallbackDetail: "Couldn't save the carrier details.",
    });
  }
}

async function lifecycleAction(
  uuid: string,
  path: string,
  body: Record<string, unknown> = {},
  source: string,
  fallback: string,
): Promise<ShipmentResult> {
  const t = await token();
  if (!t) return unauthorized(source);

  try {
    const { shipment } = await api<{ shipment: Shipment }>(
      `/api/shipments/${encodeURIComponent(uuid)}/${path}`,
      { method: "POST", token: t, body: JSON.stringify(body) },
    );
    invalidate(shipment.uuid);
    return { ok: true, shipment };
  } catch (err) {
    return toErrorResult(err, { source, fallbackDetail: fallback });
  }
}

export async function markShipmentReadyAction(uuid: string) {
  return lifecycleAction(
    uuid,
    "mark-ready",
    {},
    "markShipmentReadyAction",
    "Couldn't mark the shipment ready.",
  );
}

export async function markShipmentDraftAction(uuid: string) {
  return lifecycleAction(
    uuid,
    "mark-draft",
    {},
    "markShipmentDraftAction",
    "Couldn't reopen the shipment for edits.",
  );
}

export async function confirmShipmentPickupAction(
  uuid: string,
  payload: import("./types").ShipmentPickupChecklist,
) {
  return lifecycleAction(
    uuid,
    "pickup",
    payload as unknown as Record<string, unknown>,
    "confirmShipmentPickupAction",
    "Couldn't record the pickup.",
  );
}

export async function confirmShipmentDeliveryAction(
  uuid: string,
  payload: import("./types").ShipmentDeliveryPayload,
) {
  return lifecycleAction(
    uuid,
    "confirm-delivery",
    payload as unknown as Record<string, unknown>,
    "confirmShipmentDeliveryAction",
    "Couldn't confirm the delivery.",
  );
}

/** Update the carrier's parcel-tracking reference (DHL waybill /
 *  DPD parcel id / etc.) at any lifecycle stage. Distinct from
 *  ``updateShipmentAction`` because the general edit gate closes at
 *  ``picked_up`` — but carriers frequently issue the tracking
 *  reference AFTER the truck departs, so the desk needs a way to
 *  attach it later. Empty string clears. Flows through to the
 *  portal Dispatch card via the integration payload. */
export async function updateShipmentTrackingNumberAction(
  uuid: string,
  trackingNumber: string,
): Promise<ShipmentResult> {
  const t = await token();
  if (!t) return unauthorized("updateShipmentTrackingNumberAction");

  try {
    const { shipment } = await api<{ shipment: Shipment }>(
      `/api/shipments/${encodeURIComponent(uuid)}/tracking-number`,
      {
        method: "PATCH",
        token: t,
        body: JSON.stringify({ tracking_number: trackingNumber }),
      },
    );
    invalidate(shipment.uuid);
    return { ok: true, shipment };
  } catch (err) {
    return toErrorResult(err, {
      source: "updateShipmentTrackingNumberAction",
      fallbackDetail: "Couldn't save the tracking number.",
    });
  }
}

export async function cancelShipmentAction(uuid: string, reason: string) {
  return lifecycleAction(
    uuid,
    "cancel",
    { reason },
    "cancelShipmentAction",
    "Couldn't cancel the shipment.",
  );
}
