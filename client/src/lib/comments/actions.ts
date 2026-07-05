"use server";

import { api } from "../api";
import { getSessionToken } from "../auth/server";
import {
  toErrorResult,
  unauthorizedResult,
  type ErrorResult,
} from "../errors/server";
import { COMMENTS_PATH } from "./server";
import type {
  Comment,
  CommentEntityType,
  CommentFile,
  CommentFileKind,
  CommentVisibility,
} from "./types";

export type CommentResult = { ok: true; comment: Comment } | ErrorResult;
export type ListCommentsResult =
  | { ok: true; items: Comment[] }
  | ErrorResult;
export type FileAttachResult = { ok: true; file: CommentFile } | ErrorResult;
export type FileDeleteResult = { ok: true } | ErrorResult;
export type ReactionResult = { ok: true } | ErrorResult;

function pathFor(entityType: CommentEntityType, entityUuid: string): string {
  const prefix = COMMENTS_PATH[entityType];
  return `/api/${prefix}/${encodeURIComponent(entityUuid)}/comments`;
}

function commentPath(
  entityType: CommentEntityType,
  entityUuid: string,
  commentUuid: string,
): string {
  return `${pathFor(entityType, entityUuid)}/${encodeURIComponent(commentUuid)}`;
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
  parentCommentUuid: string | null = null,
): Promise<CommentResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("createCommentAction");

  try {
    const res = await api<{ comment: Comment }>(pathFor(entityType, entityUuid), {
      method: "POST",
      token,
      body: JSON.stringify({
        body,
        visibility,
        parent_comment_uuid: parentCommentUuid,
      }),
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
      commentPath(entityType, entityUuid, commentUuid),
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
      commentPath(entityType, entityUuid, commentUuid),
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

// ── Attachments ───────────────────────────────────────────────────

/** Post a single file to a comment. Multipart body per task-263
 *  backend contract: `file` (binary), `kind` (one of the CommentFileKind
 *  literals), plus optional `caption` for pre-send previews. The server
 *  broadcasts `file:attached` to peers on success — we return the freshly
 *  serialized `CommentFile` so the caller can optimistically append it
 *  without waiting for the channel event to round-trip. */
export async function attachFileAction(
  entityType: CommentEntityType,
  entityUuid: string,
  commentUuid: string,
  file: File,
  kind: CommentFileKind,
  extra?: { caption?: string; duration_ms?: number; waveform?: string },
): Promise<FileAttachResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("attachFileAction");

  const form = new FormData();
  form.append("file", file);
  form.append("kind", kind);
  if (extra?.caption) form.append("caption", extra.caption);
  if (typeof extra?.duration_ms === "number") {
    form.append("duration_ms", String(extra.duration_ms));
  }
  if (extra?.waveform) form.append("waveform", extra.waveform);

  try {
    const res = await api<{ file: CommentFile }>(
      `${commentPath(entityType, entityUuid, commentUuid)}/files`,
      { method: "POST", token, body: form },
    );
    return { ok: true, file: res.file };
  } catch (err) {
    return toErrorResult(err, {
      source: "attachFileAction",
      fallbackDetail: "Couldn't attach the file.",
    });
  }
}

/** Remove an attachment from a comment. Author-only; backend enforces
 *  the same gate the UI does. Broadcasts `file:removed` to peers. */
export async function deleteFileAction(
  entityType: CommentEntityType,
  entityUuid: string,
  commentUuid: string,
  fileUuid: string,
): Promise<FileDeleteResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("deleteFileAction");

  try {
    await api<void>(
      `${commentPath(entityType, entityUuid, commentUuid)}/files/${encodeURIComponent(fileUuid)}`,
      { method: "DELETE", token },
    );
    return { ok: true };
  } catch (err) {
    return toErrorResult(err, {
      source: "deleteFileAction",
      fallbackDetail: "Couldn't remove the attachment.",
    });
  }
}

// ── Reactions ─────────────────────────────────────────────────────

/** Toggle-on: add the viewer's reaction with `emoji`. Idempotent per
 *  (viewer, emoji, comment) — a second call with the same trio is a
 *  no-op. Broadcasts `reaction:added` (with the viewer's `own_reacted`
 *  flag stripped — peers get `own_reacted: false`, only the caller
 *  sees `true`). */
export async function addReactionAction(
  entityType: CommentEntityType,
  entityUuid: string,
  commentUuid: string,
  emoji: string,
): Promise<ReactionResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("addReactionAction");

  try {
    await api<void>(
      `${commentPath(entityType, entityUuid, commentUuid)}/reactions`,
      {
        method: "POST",
        token,
        body: JSON.stringify({ emoji }),
      },
    );
    return { ok: true };
  } catch (err) {
    return toErrorResult(err, {
      source: "addReactionAction",
      fallbackDetail: "Couldn't add the reaction.",
    });
  }
}

/** Toggle-off: drop the viewer's reaction with `emoji`. No-op when the
 *  viewer hadn't reacted with that emoji. Broadcasts `reaction:removed`. */
export async function removeReactionAction(
  entityType: CommentEntityType,
  entityUuid: string,
  commentUuid: string,
  emoji: string,
): Promise<ReactionResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("removeReactionAction");

  try {
    await api<void>(
      `${commentPath(entityType, entityUuid, commentUuid)}/reactions/${encodeURIComponent(emoji)}`,
      { method: "DELETE", token },
    );
    return { ok: true };
  } catch (err) {
    return toErrorResult(err, {
      source: "removeReactionAction",
      fallbackDetail: "Couldn't remove the reaction.",
    });
  }
}
