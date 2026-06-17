"use server";

import { revalidatePath } from "next/cache";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import {
  toErrorResult,
  unauthorizedResult,
  type ErrorResult,
} from "../errors/server";
import type {
  BOM,
  BOMUpsertInput,
  ManufacturingOrder,
  ManufacturingOrderBooking,
  ManufacturingOrderBookingUpsertInput,
  ManufacturingOrderStatus,
  ManufacturingOrderStep,
  ManufacturingOrderStepUpsertInput,
  ManufacturingOrderUpsertInput,
  MOSignatureAction,
  Routing,
  RoutingUpsertInput,
  Workstation,
  WorkstationGroup,
  WorkstationGroupUpsertInput,
  WorkstationUpsertInput,
} from "./types";

export type BOMResult =
  | { ok: true; bom: BOM }
  | (ErrorResult & { ok: false });

export async function createBOMAction(
  attrs: BOMUpsertInput,
): Promise<BOMResult> {
  const token = await getSessionToken();
  if (!token) return { ok: false, ...unauthorizedResult("createBOMAction") };
  try {
    const { bom } = await api<{ bom: BOM }>("/api/production/boms", {
      method: "POST",
      token,
      body: JSON.stringify(attrs),
    });
    revalidatePath("/production/boms");
    return { ok: true, bom };
  } catch (err) {
    return {
      ok: false,
      ...toErrorResult(err, {
        source: "createBOMAction",
        fallbackDetail: "Couldn't create the BOM.",
      }),
    };
  }
}

export async function updateBOMAction(
  uuid: string,
  attrs: BOMUpsertInput,
): Promise<BOMResult> {
  const token = await getSessionToken();
  if (!token) return { ok: false, ...unauthorizedResult("updateBOMAction") };
  try {
    const { bom } = await api<{ bom: BOM }>(
      `/api/production/boms/${encodeURIComponent(uuid)}`,
      {
        method: "PATCH",
        token,
        body: JSON.stringify(attrs),
      },
    );
    revalidatePath("/production/boms");
    revalidatePath(`/production/boms/${uuid}`);
    return { ok: true, bom };
  } catch (err) {
    return {
      ok: false,
      ...toErrorResult(err, {
        source: "updateBOMAction",
        fallbackDetail: "Couldn't save the BOM.",
      }),
    };
  }
}

export async function setBOMPrimaryAction(uuid: string): Promise<BOMResult> {
  const token = await getSessionToken();
  if (!token) return { ok: false, ...unauthorizedResult("setBOMPrimaryAction") };
  try {
    const { bom } = await api<{ bom: BOM }>(
      `/api/production/boms/${encodeURIComponent(uuid)}/set-primary`,
      { method: "POST", token, body: "{}" },
    );
    revalidatePath("/production/boms");
    revalidatePath(`/production/boms/${uuid}`);
    return { ok: true, bom };
  } catch (err) {
    return {
      ok: false,
      ...toErrorResult(err, {
        source: "setBOMPrimaryAction",
        fallbackDetail: "Couldn't set this BOM as primary.",
      }),
    };
  }
}

export async function revertBOMAction(
  uuid: string,
  versionNo: number,
): Promise<BOMResult> {
  const token = await getSessionToken();
  if (!token) return { ok: false, ...unauthorizedResult("revertBOMAction") };
  try {
    const { bom } = await api<{ bom: BOM }>(
      `/api/production/boms/${encodeURIComponent(uuid)}/revert`,
      {
        method: "POST",
        token,
        body: JSON.stringify({ version_no: versionNo }),
      },
    );
    revalidatePath("/production/boms");
    revalidatePath(`/production/boms/${uuid}`);
    return { ok: true, bom };
  } catch (err) {
    return {
      ok: false,
      ...toErrorResult(err, {
        source: "revertBOMAction",
        fallbackDetail: "Couldn't revert to that version.",
      }),
    };
  }
}

export async function deleteBOMAction(
  uuid: string,
): Promise<{ ok: true } | (ErrorResult & { ok: false })> {
  const token = await getSessionToken();
  if (!token) return { ok: false, ...unauthorizedResult("deleteBOMAction") };
  try {
    await api<void>(`/api/production/boms/${encodeURIComponent(uuid)}`, {
      method: "DELETE",
      token,
    });
    revalidatePath("/production/boms");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      ...toErrorResult(err, {
        source: "deleteBOMAction",
        fallbackDetail: "Couldn't delete the BOM.",
      }),
    };
  }
}

// ---------------------------------------------------------------
// Workstation groups
// ---------------------------------------------------------------

export type WorkstationGroupResult =
  | { ok: true; group: WorkstationGroup }
  | (ErrorResult & { ok: false });

export async function createWorkstationGroupAction(
  attrs: WorkstationGroupUpsertInput,
): Promise<WorkstationGroupResult> {
  const token = await getSessionToken();
  if (!token)
    return { ok: false, ...unauthorizedResult("createWorkstationGroupAction") };
  try {
    const { group } = await api<{ group: WorkstationGroup }>(
      "/api/production/workstation-groups",
      { method: "POST", token, body: JSON.stringify(attrs) },
    );
    revalidatePath("/production/workstation-groups");
    return { ok: true, group };
  } catch (err) {
    return {
      ok: false,
      ...toErrorResult(err, {
        source: "createWorkstationGroupAction",
        fallbackDetail: "Couldn't create the workstation group.",
      }),
    };
  }
}

export async function updateWorkstationGroupAction(
  uuid: string,
  attrs: WorkstationGroupUpsertInput,
): Promise<WorkstationGroupResult> {
  const token = await getSessionToken();
  if (!token)
    return { ok: false, ...unauthorizedResult("updateWorkstationGroupAction") };
  try {
    const { group } = await api<{ group: WorkstationGroup }>(
      `/api/production/workstation-groups/${encodeURIComponent(uuid)}`,
      { method: "PATCH", token, body: JSON.stringify(attrs) },
    );
    revalidatePath("/production/workstation-groups");
    revalidatePath(`/production/workstation-groups/${uuid}`);
    return { ok: true, group };
  } catch (err) {
    return {
      ok: false,
      ...toErrorResult(err, {
        source: "updateWorkstationGroupAction",
        fallbackDetail: "Couldn't save the workstation group.",
      }),
    };
  }
}

export async function deleteWorkstationGroupAction(
  uuid: string,
): Promise<{ ok: true } | (ErrorResult & { ok: false })> {
  const token = await getSessionToken();
  if (!token)
    return { ok: false, ...unauthorizedResult("deleteWorkstationGroupAction") };
  try {
    await api<void>(
      `/api/production/workstation-groups/${encodeURIComponent(uuid)}`,
      { method: "DELETE", token },
    );
    revalidatePath("/production/workstation-groups");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      ...toErrorResult(err, {
        source: "deleteWorkstationGroupAction",
        fallbackDetail: "Couldn't delete the workstation group.",
      }),
    };
  }
}

// ---------------------------------------------------------------
// Workstations
// ---------------------------------------------------------------

export type WorkstationResult =
  | { ok: true; workstation: Workstation }
  | (ErrorResult & { ok: false });

export async function createWorkstationAction(
  attrs: WorkstationUpsertInput,
): Promise<WorkstationResult> {
  const token = await getSessionToken();
  if (!token)
    return { ok: false, ...unauthorizedResult("createWorkstationAction") };
  try {
    const { workstation } = await api<{ workstation: Workstation }>(
      "/api/production/workstations",
      { method: "POST", token, body: JSON.stringify(attrs) },
    );
    revalidatePath("/production/workstations");
    return { ok: true, workstation };
  } catch (err) {
    return {
      ok: false,
      ...toErrorResult(err, {
        source: "createWorkstationAction",
        fallbackDetail: "Couldn't create the workstation.",
      }),
    };
  }
}

export async function updateWorkstationAction(
  uuid: string,
  attrs: WorkstationUpsertInput,
): Promise<WorkstationResult> {
  const token = await getSessionToken();
  if (!token)
    return { ok: false, ...unauthorizedResult("updateWorkstationAction") };
  try {
    const { workstation } = await api<{ workstation: Workstation }>(
      `/api/production/workstations/${encodeURIComponent(uuid)}`,
      { method: "PATCH", token, body: JSON.stringify(attrs) },
    );
    revalidatePath("/production/workstations");
    revalidatePath(`/production/workstations/${uuid}`);
    return { ok: true, workstation };
  } catch (err) {
    return {
      ok: false,
      ...toErrorResult(err, {
        source: "updateWorkstationAction",
        fallbackDetail: "Couldn't save the workstation.",
      }),
    };
  }
}

export async function deleteWorkstationAction(
  uuid: string,
): Promise<{ ok: true } | (ErrorResult & { ok: false })> {
  const token = await getSessionToken();
  if (!token)
    return { ok: false, ...unauthorizedResult("deleteWorkstationAction") };
  try {
    await api<void>(
      `/api/production/workstations/${encodeURIComponent(uuid)}`,
      { method: "DELETE", token },
    );
    revalidatePath("/production/workstations");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      ...toErrorResult(err, {
        source: "deleteWorkstationAction",
        fallbackDetail: "Couldn't delete the workstation.",
      }),
    };
  }
}

// ---------------------------------------------------------------
// Routings
// ---------------------------------------------------------------

export type RoutingResult =
  | { ok: true; routing: Routing }
  | (ErrorResult & { ok: false });

export async function createRoutingAction(
  attrs: RoutingUpsertInput,
): Promise<RoutingResult> {
  const token = await getSessionToken();
  if (!token) return { ok: false, ...unauthorizedResult("createRoutingAction") };
  try {
    const { routing } = await api<{ routing: Routing }>(
      "/api/production/routings",
      { method: "POST", token, body: JSON.stringify(attrs) },
    );
    revalidatePath("/production/routings");
    return { ok: true, routing };
  } catch (err) {
    return {
      ok: false,
      ...toErrorResult(err, {
        source: "createRoutingAction",
        fallbackDetail: "Couldn't create the routing.",
      }),
    };
  }
}

export async function updateRoutingAction(
  uuid: string,
  attrs: RoutingUpsertInput,
): Promise<RoutingResult> {
  const token = await getSessionToken();
  if (!token) return { ok: false, ...unauthorizedResult("updateRoutingAction") };
  try {
    const { routing } = await api<{ routing: Routing }>(
      `/api/production/routings/${encodeURIComponent(uuid)}`,
      { method: "PATCH", token, body: JSON.stringify(attrs) },
    );
    revalidatePath("/production/routings");
    revalidatePath(`/production/routings/${uuid}`);
    return { ok: true, routing };
  } catch (err) {
    return {
      ok: false,
      ...toErrorResult(err, {
        source: "updateRoutingAction",
        fallbackDetail: "Couldn't save the routing.",
      }),
    };
  }
}

export async function deleteRoutingAction(
  uuid: string,
): Promise<{ ok: true } | (ErrorResult & { ok: false })> {
  const token = await getSessionToken();
  if (!token) return { ok: false, ...unauthorizedResult("deleteRoutingAction") };
  try {
    await api<void>(`/api/production/routings/${encodeURIComponent(uuid)}`, {
      method: "DELETE",
      token,
    });
    revalidatePath("/production/routings");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      ...toErrorResult(err, {
        source: "deleteRoutingAction",
        fallbackDetail: "Couldn't delete the routing.",
      }),
    };
  }
}

// ---------------------------------------------------------------
// Manufacturing orders
// ---------------------------------------------------------------

export type ManufacturingOrderResult =
  | { ok: true; mo: ManufacturingOrder }
  | (ErrorResult & { ok: false });

export async function createManufacturingOrderAction(
  attrs: ManufacturingOrderUpsertInput,
): Promise<ManufacturingOrderResult> {
  const token = await getSessionToken();
  if (!token)
    return { ok: false, ...unauthorizedResult("createManufacturingOrderAction") };
  try {
    const { mo } = await api<{ mo: ManufacturingOrder }>(
      "/api/production/manufacturing-orders",
      { method: "POST", token, body: JSON.stringify(attrs) },
    );
    revalidatePath("/production/manufacturing-orders");
    return { ok: true, mo };
  } catch (err) {
    return {
      ok: false,
      ...toErrorResult(err, {
        source: "createManufacturingOrderAction",
        fallbackDetail: "Couldn't create the manufacturing order.",
      }),
    };
  }
}

export async function updateManufacturingOrderAction(
  uuid: string,
  attrs: ManufacturingOrderUpsertInput,
): Promise<ManufacturingOrderResult> {
  const token = await getSessionToken();
  if (!token)
    return { ok: false, ...unauthorizedResult("updateManufacturingOrderAction") };
  try {
    const { mo } = await api<{ mo: ManufacturingOrder }>(
      `/api/production/manufacturing-orders/${encodeURIComponent(uuid)}`,
      { method: "PATCH", token, body: JSON.stringify(attrs) },
    );
    revalidatePath("/production/manufacturing-orders");
    revalidatePath(`/production/manufacturing-orders/${uuid}`);
    return { ok: true, mo };
  } catch (err) {
    return {
      ok: false,
      ...toErrorResult(err, {
        source: "updateManufacturingOrderAction",
        fallbackDetail: "Couldn't save the manufacturing order.",
      }),
    };
  }
}

export async function transitionManufacturingOrderAction(
  uuid: string,
  to: ManufacturingOrderStatus,
): Promise<ManufacturingOrderResult> {
  const token = await getSessionToken();
  if (!token)
    return {
      ok: false,
      ...unauthorizedResult("transitionManufacturingOrderAction"),
    };
  try {
    const { mo } = await api<{ mo: ManufacturingOrder }>(
      `/api/production/manufacturing-orders/${encodeURIComponent(uuid)}/transition`,
      { method: "POST", token, body: JSON.stringify({ to }) },
    );
    revalidatePath("/production/manufacturing-orders");
    revalidatePath(`/production/manufacturing-orders/${uuid}`);
    return { ok: true, mo };
  } catch (err) {
    return {
      ok: false,
      ...toErrorResult(err, {
        source: "transitionManufacturingOrderAction",
        fallbackDetail: "Couldn't change the manufacturing order's status.",
      }),
    };
  }
}

/**
 * Merge this MO into another batch — cancels this MO, bumps the
 * target's qty, records a consumer link from target → this MO's
 * parent. BE rejects if items differ, either MO is past
 * pre-execution, or the merge would create a cycle.
 */
export async function mergeMOIntoBatchAction(
  sourceUuid: string,
  targetUuid: string,
): Promise<ManufacturingOrderResult> {
  const token = await getSessionToken();
  if (!token)
    return { ok: false, ...unauthorizedResult("mergeMOIntoBatchAction") };
  try {
    const { mo } = await api<{ mo: ManufacturingOrder }>(
      `/api/production/manufacturing-orders/${encodeURIComponent(sourceUuid)}/merge-into`,
      {
        method: "POST",
        token,
        body: JSON.stringify({ target_uuid: targetUuid }),
      },
    );
    revalidatePath("/production/manufacturing-orders");
    revalidatePath(`/production/manufacturing-orders/${sourceUuid}`);
    revalidatePath(`/production/manufacturing-orders/${targetUuid}`);
    return { ok: true, mo };
  } catch (err) {
    return {
      ok: false,
      ...toErrorResult(err, {
        source: "mergeMOIntoBatchAction",
        fallbackDetail: "Couldn't merge MO into the target batch.",
      }),
    };
  }
}

/**
 * Slide an entire project (root MO + every descendant via
 * parent_mo_id) by `deltaSeconds`. Used by the project-view drag
 * handler so the whole chain moves together in one round-trip.
 */
export async function shiftProjectAction(
  rootUuid: string,
  deltaSeconds: number,
): Promise<ManufacturingOrderResult> {
  const token = await getSessionToken();
  if (!token)
    return { ok: false, ...unauthorizedResult("shiftProjectAction") };
  try {
    const { mo } = await api<{ mo: ManufacturingOrder }>(
      `/api/production/manufacturing-orders/${encodeURIComponent(rootUuid)}/shift-chain`,
      {
        method: "POST",
        token,
        body: JSON.stringify({ delta_seconds: deltaSeconds }),
      },
    );
    revalidatePath("/production/manufacturing-orders");
    revalidatePath(`/production/manufacturing-orders/${rootUuid}`);
    revalidatePath("/production/schedule");
    return { ok: true, mo };
  } catch (err) {
    return {
      ok: false,
      ...toErrorResult(err, {
        source: "shiftProjectAction",
        fallbackDetail: "Couldn't reschedule the project.",
      }),
    };
  }
}

/**
 * Slide an entire MO's schedule (header + all steps) by
 * `deltaSeconds`. Used by the production schedule drag handler so
 * a single drop is one round-trip + atomic on the BE.
 */
export async function shiftManufacturingOrderAction(
  uuid: string,
  deltaSeconds: number,
): Promise<ManufacturingOrderResult> {
  const token = await getSessionToken();
  if (!token)
    return {
      ok: false,
      ...unauthorizedResult("shiftManufacturingOrderAction"),
    };
  try {
    const { mo } = await api<{ mo: ManufacturingOrder }>(
      `/api/production/manufacturing-orders/${encodeURIComponent(uuid)}/shift`,
      {
        method: "POST",
        token,
        body: JSON.stringify({ delta_seconds: deltaSeconds }),
      },
    );
    revalidatePath("/production/manufacturing-orders");
    revalidatePath(`/production/manufacturing-orders/${uuid}`);
    revalidatePath("/production/schedule");
    return { ok: true, mo };
  } catch (err) {
    return {
      ok: false,
      ...toErrorResult(err, {
        source: "shiftManufacturingOrderAction",
        fallbackDetail: "Couldn't reschedule the MO.",
      }),
    };
  }
}

/**
 * Approval-workflow actions (prepare / unprepare / approve / reject /
 * amend). Reject MUST include a non-empty reason; the others ignore
 * it. All four cascade down the MO tree on the BE.
 */
export async function signMOAction(
  uuid: string,
  action: MOSignatureAction,
  reason?: string,
): Promise<ManufacturingOrderResult> {
  const token = await getSessionToken();
  if (!token) return { ok: false, ...unauthorizedResult("signMOAction") };

  const body: Record<string, unknown> = { action };
  if (action === "reject" && reason) body.reason = reason;

  try {
    const { mo } = await api<{ mo: ManufacturingOrder }>(
      `/api/production/manufacturing-orders/${encodeURIComponent(uuid)}/transition`,
      { method: "POST", token, body: JSON.stringify(body) },
    );
    revalidatePath("/production/manufacturing-orders");
    revalidatePath(`/production/manufacturing-orders/${uuid}`);
    return { ok: true, mo };
  } catch (err) {
    return {
      ok: false,
      ...toErrorResult(err, {
        source: "signMOAction",
        fallbackDetail: "Couldn't record the signature.",
      }),
    };
  }
}

export async function deleteManufacturingOrderAction(
  uuid: string,
): Promise<{ ok: true } | (ErrorResult & { ok: false })> {
  const token = await getSessionToken();
  if (!token)
    return { ok: false, ...unauthorizedResult("deleteManufacturingOrderAction") };
  try {
    await api<void>(
      `/api/production/manufacturing-orders/${encodeURIComponent(uuid)}`,
      { method: "DELETE", token },
    );
    revalidatePath("/production/manufacturing-orders");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      ...toErrorResult(err, {
        source: "deleteManufacturingOrderAction",
        fallbackDetail: "Couldn't delete the manufacturing order.",
      }),
    };
  }
}

// ---------------------------------------------------------------
// MO operation steps
// ---------------------------------------------------------------

export type ManufacturingOrderStepResult =
  | { ok: true; step: ManufacturingOrderStep }
  | (ErrorResult & { ok: false });

export async function updateManufacturingOrderStepAction(
  moUuid: string,
  stepUuid: string,
  attrs: ManufacturingOrderStepUpsertInput,
): Promise<ManufacturingOrderStepResult> {
  const token = await getSessionToken();
  if (!token)
    return {
      ok: false,
      ...unauthorizedResult("updateManufacturingOrderStepAction"),
    };
  try {
    const { step } = await api<{ step: ManufacturingOrderStep }>(
      `/api/production/manufacturing-orders/${encodeURIComponent(moUuid)}/steps/${encodeURIComponent(stepUuid)}`,
      { method: "PATCH", token, body: JSON.stringify(attrs) },
    );
    revalidatePath(`/production/manufacturing-orders/${moUuid}`);
    revalidatePath(
      `/production/manufacturing-orders/${moUuid}/operations/${stepUuid}`,
    );
    return { ok: true, step };
  } catch (err) {
    return {
      ok: false,
      ...toErrorResult(err, {
        source: "updateManufacturingOrderStepAction",
        fallbackDetail: "Couldn't save the operation.",
      }),
    };
  }
}

// ---------------------------------------------------------------
// MO stock bookings
// ---------------------------------------------------------------

export type ManufacturingOrderBookingResult =
  | { ok: true; booking: ManufacturingOrderBooking }
  | (ErrorResult & { ok: false });

export async function createBookingAction(
  moUuid: string,
  attrs: ManufacturingOrderBookingUpsertInput,
): Promise<ManufacturingOrderBookingResult> {
  const token = await getSessionToken();
  if (!token) return { ok: false, ...unauthorizedResult("createBookingAction") };
  try {
    const { booking } = await api<{ booking: ManufacturingOrderBooking }>(
      `/api/production/manufacturing-orders/${encodeURIComponent(moUuid)}/bookings`,
      { method: "POST", token, body: JSON.stringify(attrs) },
    );
    revalidatePath(`/production/manufacturing-orders/${moUuid}`);
    return { ok: true, booking };
  } catch (err) {
    return {
      ok: false,
      ...toErrorResult(err, {
        source: "createBookingAction",
        fallbackDetail: "Couldn't book that lot.",
      }),
    };
  }
}

export async function updateBookingAction(
  moUuid: string,
  bookingUuid: string,
  attrs: ManufacturingOrderBookingUpsertInput,
): Promise<ManufacturingOrderBookingResult> {
  const token = await getSessionToken();
  if (!token) return { ok: false, ...unauthorizedResult("updateBookingAction") };
  try {
    const { booking } = await api<{ booking: ManufacturingOrderBooking }>(
      `/api/production/manufacturing-orders/${encodeURIComponent(moUuid)}/bookings/${encodeURIComponent(bookingUuid)}`,
      { method: "PATCH", token, body: JSON.stringify(attrs) },
    );
    revalidatePath(`/production/manufacturing-orders/${moUuid}`);
    return { ok: true, booking };
  } catch (err) {
    return {
      ok: false,
      ...toErrorResult(err, {
        source: "updateBookingAction",
        fallbackDetail: "Couldn't update the booking.",
      }),
    };
  }
}

export async function deleteBookingAction(
  moUuid: string,
  bookingUuid: string,
): Promise<{ ok: true } | (ErrorResult & { ok: false })> {
  const token = await getSessionToken();
  if (!token) return { ok: false, ...unauthorizedResult("deleteBookingAction") };
  try {
    await api<void>(
      `/api/production/manufacturing-orders/${encodeURIComponent(moUuid)}/bookings/${encodeURIComponent(bookingUuid)}`,
      { method: "DELETE", token },
    );
    revalidatePath(`/production/manufacturing-orders/${moUuid}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      ...toErrorResult(err, {
        source: "deleteBookingAction",
        fallbackDetail: "Couldn't release the booking.",
      }),
    };
  }
}

export type BookingStrategy = "fefo" | "fifo";

export async function bookAllPartsAction(
  moUuid: string,
  strategy: BookingStrategy = "fefo",
): Promise<
  | {
      ok: true;
      created: number;
      strategy: BookingStrategy;
      bookings: ManufacturingOrderBooking[];
    }
  | (ErrorResult & { ok: false })
> {
  const token = await getSessionToken();
  if (!token) return { ok: false, ...unauthorizedResult("bookAllPartsAction") };
  try {
    const data = await api<{
      created: number;
      strategy: BookingStrategy;
      bookings: ManufacturingOrderBooking[];
    }>(
      `/api/production/manufacturing-orders/${encodeURIComponent(moUuid)}/bookings/book-all`,
      { method: "POST", token, body: JSON.stringify({ strategy }) },
    );
    revalidatePath(`/production/manufacturing-orders/${moUuid}`);
    return { ok: true, ...data };
  } catch (err) {
    return {
      ok: false,
      ...toErrorResult(err, {
        source: "bookAllPartsAction",
        fallbackDetail: "Couldn't auto-book parts.",
      }),
    };
  }
}

export async function releaseAllPartsAction(
  moUuid: string,
): Promise<
  | { ok: true; released: number; cancelled_sub_mos: number }
  | (ErrorResult & { ok: false })
> {
  const token = await getSessionToken();
  if (!token)
    return { ok: false, ...unauthorizedResult("releaseAllPartsAction") };
  try {
    const data = await api<{ released: number; cancelled_sub_mos: number }>(
      `/api/production/manufacturing-orders/${encodeURIComponent(moUuid)}/bookings/release-all`,
      { method: "POST", token, body: JSON.stringify({}) },
    );
    revalidatePath(`/production/manufacturing-orders/${moUuid}`);
    return { ok: true, ...data };
  } catch (err) {
    return {
      ok: false,
      ...toErrorResult(err, {
        source: "releaseAllPartsAction",
        fallbackDetail: "Couldn't release the bookings.",
      }),
    };
  }
}
