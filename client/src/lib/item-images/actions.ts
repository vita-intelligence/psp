"use server";

import { revalidatePath } from "next/cache";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { ItemImage } from "../types";
import {
  toErrorResult,
  unauthorizedResult,
  type ErrorResult,
} from "../errors/server";

export type ImageResult = { ok: true; image: ItemImage } | ErrorResult;
export type DeleteResult = { ok: true } | ErrorResult;

/**
 * Multipart upload. The browser packs a `File` into FormData; we
 * proxy it through to the Phoenix endpoint with the auth cookie's
 * bearer attached. `api()` recognises FormData and skips the JSON
 * content-type so the multipart boundary is preserved.
 */
export async function uploadImageAction(
  itemUuid: string,
  formData: FormData,
): Promise<ImageResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("uploadImageAction");

  try {
    const res = await api<{ image: ItemImage }>(
      `/api/items/${itemUuid}/images`,
      { method: "POST", token, body: formData },
    );
    revalidatePath(`/production/items/${itemUuid}`);
    return { ok: true, image: res.image };
  } catch (err) {
    return toErrorResult(err, {
      source: "uploadImageAction",
      fallbackDetail: "Couldn't upload the image.",
    });
  }
}

export async function setPrimaryImageAction(
  itemUuid: string,
  imageUuid: string,
): Promise<ImageResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("setPrimaryImageAction");

  try {
    const res = await api<{ image: ItemImage }>(
      `/api/items/${itemUuid}/images/${imageUuid}/primary`,
      { method: "PUT", token },
    );
    revalidatePath(`/production/items/${itemUuid}`);
    return { ok: true, image: res.image };
  } catch (err) {
    return toErrorResult(err, {
      source: "setPrimaryImageAction",
      fallbackDetail: "Couldn't promote the image.",
    });
  }
}

export async function updateImageAction(
  itemUuid: string,
  imageUuid: string,
  input: { caption?: string | null; sort_order?: number },
): Promise<ImageResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("updateImageAction");

  try {
    const res = await api<{ image: ItemImage }>(
      `/api/items/${itemUuid}/images/${imageUuid}`,
      { method: "PUT", token, body: JSON.stringify(input) },
    );
    revalidatePath(`/production/items/${itemUuid}`);
    return { ok: true, image: res.image };
  } catch (err) {
    return toErrorResult(err, {
      source: "updateImageAction",
      fallbackDetail: "Couldn't save the image details.",
    });
  }
}

export async function deleteImageAction(
  itemUuid: string,
  imageUuid: string,
): Promise<DeleteResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("deleteImageAction");

  try {
    await api<void>(`/api/items/${itemUuid}/images/${imageUuid}`, {
      method: "DELETE",
      token,
    });
    revalidatePath(`/production/items/${itemUuid}`);
    return { ok: true };
  } catch (err) {
    return toErrorResult(err, {
      source: "deleteImageAction",
      fallbackDetail: "Couldn't delete the image.",
    });
  }
}
