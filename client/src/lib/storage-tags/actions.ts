"use server";

import { revalidatePath } from "next/cache";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { StorageTag } from "../types";
import {
  toErrorResult,
  unauthorizedResult,
  type ErrorResult,
} from "../errors/server";

export type TagResult =
  | { ok: true; tag: StorageTag }
  | ErrorResult;

export type DeleteResult = { ok: true } | ErrorResult;

interface TagInput {
  key?: string;
  label?: string;
  description?: string | null;
  kind?: "location" | "cell" | "both";
}

export async function createTagAction(
  input: TagInput,
): Promise<TagResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("createTagAction");

  try {
    const res = await api<{ tag: StorageTag }>(`/api/storage-tags`, {
      method: "POST",
      token,
      body: JSON.stringify(input),
    });
    revalidatePath(`/settings/storage-tags`);
    return { ok: true, tag: res.tag };
  } catch (err) {
    return toErrorResult(err, {
      source: "createTagAction",
      fallbackDetail: "Couldn't create the tag.",
    });
  }
}

export async function updateTagAction(
  uuid: string,
  input: TagInput,
): Promise<TagResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("updateTagAction");

  try {
    const res = await api<{ tag: StorageTag }>(
      `/api/storage-tags/${uuid}`,
      { method: "PUT", token, body: JSON.stringify(input) },
    );
    revalidatePath(`/settings/storage-tags`);
    return { ok: true, tag: res.tag };
  } catch (err) {
    return toErrorResult(err, {
      source: "updateTagAction",
      fallbackDetail: "Couldn't update the tag.",
    });
  }
}

export async function deleteTagAction(
  uuid: string,
): Promise<DeleteResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("deleteTagAction");

  try {
    await api<void>(`/api/storage-tags/${uuid}`, {
      method: "DELETE",
      token,
    });
    revalidatePath(`/settings/storage-tags`);
    return { ok: true };
  } catch (err) {
    return toErrorResult(err, {
      source: "deleteTagAction",
      fallbackDetail: "Couldn't delete the tag.",
    });
  }
}
