"use server";

import { api } from "../api";
import { getSessionToken } from "../auth/server";
import {
  toErrorResult,
  unauthorizedResult,
  type ErrorResult,
} from "../errors/server";
import { COMMENTS_PATH } from "./server";
import type { Comment, CommentEntityType, CommentVisibility } from "./types";

export type CommentResult = { ok: true; comment: Comment } | ErrorResult;
export type ListCommentsResult =
  | { ok: true; items: Comment[] }
  | ErrorResult;

function pathFor(entityType: CommentEntityType, entityUuid: string): string {
  const prefix = COMMENTS_PATH[entityType];
  return `/api/${prefix}/${encodeURIComponent(entityUuid)}/comments`;
}

/** Client-component fetch — used after the channel reconnects to
 *  reconcile any messages that landed while we were offline. */
export async function listCommentsAction(
  entityType: CommentEntityType,
  entityUuid: string,
): Promise<ListCommentsResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("listCommentsAction");

  try {
    const { items } = await api<{ items: Comment[] }>(
      pathFor(entityType, entityUuid),
      { token },
    );
    return { ok: true, items };
  } catch (err) {
    return toErrorResult(err, {
      source: "listCommentsAction",
      fallbackDetail: "Couldn't load the discussion.",
    });
  }
}

export async function createCommentAction(
  entityType: CommentEntityType,
  entityUuid: string,
  body: string,
  visibility: CommentVisibility = "internal",
): Promise<CommentResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("createCommentAction");

  try {
    const res = await api<{ comment: Comment }>(pathFor(entityType, entityUuid), {
      method: "POST",
      token,
      body: JSON.stringify({ body, visibility }),
    });
    return { ok: true, comment: res.comment };
  } catch (err) {
    return toErrorResult(err, {
      source: "createCommentAction",
      fallbackDetail: "Couldn't post the comment.",
    });
  }
}

export async function updateCommentAction(
  entityType: CommentEntityType,
  entityUuid: string,
  commentUuid: string,
  body: string,
): Promise<CommentResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("updateCommentAction");

  try {
    const res = await api<{ comment: Comment }>(
      `${pathFor(entityType, entityUuid)}/${encodeURIComponent(commentUuid)}`,
      {
        method: "PATCH",
        token,
        body: JSON.stringify({ body }),
      },
    );
    return { ok: true, comment: res.comment };
  } catch (err) {
    return toErrorResult(err, {
      source: "updateCommentAction",
      fallbackDetail: "Couldn't update the comment.",
    });
  }
}

export async function deleteCommentAction(
  entityType: CommentEntityType,
  entityUuid: string,
  commentUuid: string,
): Promise<CommentResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("deleteCommentAction");

  try {
    const res = await api<{ comment: Comment }>(
      `${pathFor(entityType, entityUuid)}/${encodeURIComponent(commentUuid)}`,
      { method: "DELETE", token },
    );
    return { ok: true, comment: res.comment };
  } catch (err) {
    return toErrorResult(err, {
      source: "deleteCommentAction",
      fallbackDetail: "Couldn't delete the comment.",
    });
  }
}
