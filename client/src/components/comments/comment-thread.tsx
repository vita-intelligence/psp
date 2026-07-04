"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { MessageSquare } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ErrorBanner } from "@/components/forms/error-banner";
import type { ErrorDebug } from "@/lib/errors/types";
import {
  addReactionAction,
  attachFileAction,
  createCommentAction,
  deleteCommentAction,
  listCommentsAction,
  removeReactionAction,
  updateCommentAction,
} from "@/lib/comments/actions";
import {
  useCommentChannel,
  type FileAttachedEvent,
  type FileRemovedEvent,
  type JoinError,
  type ReactionEvent,
} from "@/lib/comments/use-comment-channel";
import type {
  Comment,
  CommentEntityType,
  CommentParentRef,
  CommentReaction,
} from "@/lib/comments/types";
import { MessageStream } from "./message-stream";
import { CommentComposer } from "./comment-composer";
import type { StagedFile } from "./file-send-preview";

interface CommentThreadProps {
  entityType: CommentEntityType;
  entityUuid: string;
  /** Server-fetched initial timeline. The component then takes over
   *  via channel events + optimistic local writes. */
  initial: Comment[];
  /** Whether the viewing user has write permission. Disables the
   *  composer + the edit/delete buttons. */
  canComment: boolean;
  /** Id of the current user — used to decide which rows expose
   *  edit/delete handles to the viewer. */
  currentUserId: number;
}

interface BannerError {
  detail: string;
  code?: string;
  debug?: ErrorDebug;
}

/**
 * Messenger-style polymorphic comment thread. Drop this on any
 * entity's detail page; the rest of the wiring lives in
 * `Backend.Comments` + the `CommentsController` + `CommentChannel`.
 *
 * The rendering was rebuilt to look and feel like a chat surface —
 * own vs peer bubbles, day dividers, nested reply threads, hover-
 * reveal reactions, file attachments — while keeping the same
 * public API so the existing 18 pages don't have to change.
 *
 * Realtime: subscribes to `comments:<entity_type>:<entity_uuid>` for
 * `comment:created`, `comment:updated`, `comment:deleted`,
 * `file:attached`, `file:removed`, `reaction:added`, `reaction:removed`.
 * Optimistic local writes use the same upsert paths so a peer's
 * channel event and the caller's own action can race without
 * corrupting state (upserts are idempotent on uuid).
 */
export function CommentThread({
  entityType,
  entityUuid,
  initial,
  canComment,
  currentUserId,
}: CommentThreadProps) {
  const [comments, setComments] = useState<Comment[]>(() =>
    initial.map(hydrate).sort(byCreated),
  );
  const [error, setError] = useState<BannerError | null>(null);
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<{
    uuid: string;
    body: string;
  } | null>(null);
  const [replying, setReplying] = useState<CommentParentRef | null>(null);

  // Upserts + partial updates ────────────────────────────────────
  const upsertComment = useCallback((c: Comment) => {
    setComments((prev) => {
      const hydrated = hydrate(c);
      const idx = prev.findIndex((row) => row.uuid === hydrated.uuid);
      if (idx === -1) return [...prev, hydrated].sort(byCreated);
      const next = [...prev];
      next[idx] = hydrated;
      return next;
    });
  }, []);

  const attachFile = useCallback((evt: FileAttachedEvent) => {
    setComments((prev) =>
      prev.map((c) => {
        if (c.uuid !== evt.comment_uuid) return c;
        if (c.files.some((f) => f.uuid === evt.file.uuid)) return c;
        return { ...c, files: [...c.files, evt.file] };
      }),
    );
  }, []);

  const removeFile = useCallback((evt: FileRemovedEvent) => {
    setComments((prev) =>
      prev.map((c) =>
        c.uuid === evt.comment_uuid
          ? { ...c, files: c.files.filter((f) => f.uuid !== evt.file_uuid) }
          : c,
      ),
    );
  }, []);

  const applyReaction = useCallback(
    (evt: ReactionEvent, delta: 1 | -1) => {
      setComments((prev) =>
        prev.map((c) => {
          if (c.uuid !== evt.comment_uuid) return c;
          return { ...c, reactions: applyReactionDelta(c.reactions, evt, delta) };
        }),
      );
    },
    [],
  );

  const { connected, joinError, canComment: channelGrant } = useCommentChannel({
    entityType,
    entityUuid,
    onCreate: upsertComment,
    onUpdate: upsertComment,
    onDelete: upsertComment,
    onFileAttached: attachFile,
    onFileRemoved: removeFile,
    onReactionAdded: (evt) => applyReaction(evt, 1),
    onReactionRemoved: (evt) => applyReaction(evt, -1),
    disabled: false,
  });

  // Reconcile after reconnect — if the socket dropped, the controller
  // may have broadcast events we missed. Hard-refetch the timeline.
  const refresh = useCallback(async () => {
    const res = await listCommentsAction(entityType, entityUuid);
    if (res.ok) {
      setComments(res.items.map(hydrate).sort(byCreated));
    }
  }, [entityType, entityUuid]);

  const previouslyConnectedRef = useRef(false);
  useEffect(() => {
    if (connected) {
      if (previouslyConnectedRef.current) {
        void refresh();
      }
      previouslyConnectedRef.current = true;
    }
  }, [connected, refresh]);

  const effectiveCanComment = canComment && (channelGrant || !connected);

  // Actions ──────────────────────────────────────────────────────
  const submitNew = useCallback(
    (body: string) => {
      if (!effectiveCanComment) return;
      setError(null);
      const parentUuid = replying?.uuid ?? null;
      startTransition(async () => {
        const res = await createCommentAction(
          entityType,
          entityUuid,
          body,
          "internal",
          parentUuid,
        );
        if (res.ok) {
          upsertComment(res.comment);
          setReplying(null);
        } else {
          setError({ detail: res.detail, code: res.code, debug: res.debug });
        }
      });
    },
    [effectiveCanComment, entityType, entityUuid, replying, upsertComment],
  );

  const submitEdit = useCallback(
    (body: string) => {
      if (!editing) return;
      setError(null);
      startTransition(async () => {
        const res = await updateCommentAction(
          entityType,
          entityUuid,
          editing.uuid,
          body,
        );
        if (res.ok) {
          upsertComment(res.comment);
          setEditing(null);
        } else {
          setError({ detail: res.detail, code: res.code, debug: res.debug });
        }
      });
    },
    [editing, entityType, entityUuid, upsertComment],
  );

  const submitDelete = useCallback(
    (commentUuid: string) => {
      setError(null);
      startTransition(async () => {
        const res = await deleteCommentAction(
          entityType,
          entityUuid,
          commentUuid,
        );
        if (res.ok) {
          upsertComment(res.comment);
        } else {
          setError({ detail: res.detail, code: res.code, debug: res.debug });
        }
      });
    },
    [entityType, entityUuid, upsertComment],
  );

  const submitReact = useCallback(
    (commentUuid: string, emoji: string) => {
      // No optimistic flip here — the backend fans a `reaction:added`
      // / `reaction:removed` event back through the channel to every
      // subscriber including the caller, so applying our own delta
      // upfront would double-count on top of the incoming event.
      // Small latency, cleaner state.
      const cur = comments.find((c) => c.uuid === commentUuid);
      const wasReacted = cur?.reactions.some(
        (r) => r.emoji === emoji && r.own_reacted,
      );
      startTransition(async () => {
        const res = wasReacted
          ? await removeReactionAction(
              entityType,
              entityUuid,
              commentUuid,
              emoji,
            )
          : await addReactionAction(
              entityType,
              entityUuid,
              commentUuid,
              emoji,
            );
        if (!res.ok) {
          setError({ detail: res.detail, code: res.code, debug: res.debug });
        }
      });
    },
    [comments, entityType, entityUuid],
  );

  const submitFiles = useCallback(
    async (files: StagedFile[], caption: string) => {
      if (!effectiveCanComment || files.length === 0) return;
      setError(null);
      // A file batch creates ONE comment (the caption) and then
      // attaches each file to it in sequence. If the create fails we
      // bail; if a later attach fails we surface the error but keep
      // the comment intact.
      const created = await createCommentAction(
        entityType,
        entityUuid,
        caption.trim() || "​",
        "internal",
        replying?.uuid ?? null,
      );
      if (!created.ok) {
        setError({
          detail: created.detail,
          code: created.code,
          debug: created.debug,
        });
        return;
      }
      let latest = created.comment;
      upsertComment(latest);
      for (const staged of files) {
        const res = await attachFileAction(
          entityType,
          entityUuid,
          latest.uuid,
          staged.file,
          staged.kind,
        );
        if (!res.ok) {
          setError({
            detail: res.detail,
            code: res.code,
            debug: res.debug,
          });
          continue;
        }
        latest = {
          ...latest,
          files: [...latest.files, res.file],
        };
        upsertComment(latest);
      }
      setReplying(null);
    },
    [effectiveCanComment, entityType, entityUuid, replying, upsertComment],
  );

  const visibleCount = useMemo(
    () => comments.filter((c) => c.body !== "[deleted]").length,
    [comments],
  );

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquare className="size-4 text-muted-foreground" />
              Discussion
              <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">
                {visibleCount}
              </span>
            </CardTitle>
            <CardDescription className="text-xs">
              Timestamped, attributable thread. Replaces free-text notes so
              every exchange has an author, time, and audit row.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {joinError && (
          <ErrorBanner
            tone="warning"
            detail={joinErrorDetail(joinError)}
            code={"channel_" + joinError.reason}
          />
        )}

        {error && (
          <ErrorBanner
            detail={error.detail}
            code={error.code}
            debug={error.debug}
          />
        )}

        {comments.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/60 py-10 text-center text-xs text-muted-foreground">
            No comments yet.
            {effectiveCanComment ? " Start the discussion below." : ""}
          </div>
        ) : (
          <MessageStream
            comments={comments}
            currentUserId={currentUserId}
            canReply={effectiveCanComment}
            canReact={effectiveCanComment}
            onReply={(c) =>
              setReplying({
                uuid: c.uuid,
                author_name: c.author?.name ?? "Unknown",
                snippet: buildSnippet(c),
              })
            }
            onEdit={(c) => setEditing({ uuid: c.uuid, body: c.body })}
            onDelete={submitDelete}
            onReact={submitReact}
          />
        )}

        {effectiveCanComment ? (
          <CommentComposer
            pending={pending}
            replyTarget={replying}
            onCancelReply={() => setReplying(null)}
            editTarget={editing}
            onCancelEdit={() => setEditing(null)}
            onSubmit={submitNew}
            onSubmitEdit={submitEdit}
            onSubmitFiles={submitFiles}
          />
        ) : (
          <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2.5 text-[11px] text-muted-foreground">
            You can read this discussion but don&apos;t have permission to post.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── helpers ────────────────────────────────────────────────────────

/** Fill in the collection-typed fields the backend may historically
 *  omit so downstream renderers can rely on `.files.length`
 *  / `.reactions.length` unconditionally. */
function hydrate(c: Comment): Comment {
  return {
    ...c,
    files: c.files ?? [],
    reactions: c.reactions ?? [],
    parent: c.parent ?? null,
  };
}

function byCreated(a: Comment, b: Comment): number {
  if (a.created_at === b.created_at) return a.id - b.id;
  return a.created_at < b.created_at ? -1 : 1;
}

function buildSnippet(c: Comment): string {
  if (c.body && c.body !== "[deleted]") {
    return c.body.length > 120 ? c.body.slice(0, 119) + "…" : c.body;
  }
  if (c.files.length > 0) {
    return `${c.files.length} attachment${c.files.length === 1 ? "" : "s"}`;
  }
  return "(deleted)";
}

function applyReactionDelta(
  current: CommentReaction[],
  evt: ReactionEvent,
  delta: 1 | -1,
): CommentReaction[] {
  const existing = current.find((r) => r.emoji === evt.emoji);
  if (delta === 1) {
    if (existing) {
      return current.map((r) =>
        r.emoji === evt.emoji
          ? {
              ...r,
              count: r.count + 1,
              own_reacted: evt.own_reacted || r.own_reacted,
            }
          : r,
      );
    }
    return [
      ...current,
      { emoji: evt.emoji, count: 1, own_reacted: evt.own_reacted },
    ];
  }
  if (!existing) return current;
  const nextCount = Math.max(0, existing.count - 1);
  if (nextCount === 0) return current.filter((r) => r.emoji !== evt.emoji);
  return current.map((r) =>
    r.emoji === evt.emoji
      ? {
          ...r,
          count: nextCount,
          own_reacted: evt.own_reacted ? false : r.own_reacted,
        }
      : r,
  );
}

function joinErrorDetail(err: JoinError): string {
  if (err.reason === "forbidden") {
    return "You can read this discussion but the live channel rejected your join. Refresh to retry.";
  }
  if (err.reason === "not_found") {
    return "Couldn't subscribe to the live discussion — the entity may have been deleted.";
  }
  if (err.reason === "bad_topic") {
    return "Channel topic mismatch. Refresh the page.";
  }
  return "Lost the live discussion connection. Posts still work — peers may need to refresh to see them.";
}
