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
