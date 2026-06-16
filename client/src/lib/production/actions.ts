"use server";

import { revalidatePath } from "next/cache";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import {
  toErrorResult,
  unauthorizedResult,
  type ErrorResult,
} from "../errors/server";
import type { BOM, BOMUpsertInput } from "./types";

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
