"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  Loader2,
  MessageSquare,
  Pencil,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/users/user-avatar";
import { ErrorBanner } from "@/components/forms/error-banner";
import type { ErrorDebug } from "@/lib/errors/types";
import { cn } from "@/lib/utils";
import {
  createCommentAction,
  deleteCommentAction,
  listCommentsAction,
  updateCommentAction,
} from "@/lib/comments/actions";
import { useCommentChannel, type JoinError } from "@/lib/comments/use-comment-channel";
import type { Comment, CommentEntityType } from "@/lib/comments/types";

const BODY_MAX = 4000;

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
 * Polymorphic comment thread. Drop this on any entity's detail page;
 * the rest of the wiring lives in `Backend.Comments` + the
 * `CommentsController` + `CommentChannel`.
 *
 * Behaviour:
 *
 *   - Renders the server-fetched `initial` timeline.
 *   - Subscribes to `comments:<entity_type>:<entity_uuid>` for
 *     `comment:created` / `comment:updated` / `comment:deleted`
 *     events broadcast by the controller after each write.
 *   - Composer at the bottom; Ctrl/Cmd+Enter submits.
 *   - Author-only edit/delete handles on each row. Backend enforces
 *     the same gate so a stale UI can't bypass.
 *   - Soft-deleted rows render with the body replaced by a marker
 *     and the edit/delete handles hidden so an old client can't
 *     re-edit them into existence.
 *
 * Permission gating: when `canComment` is false the composer collapses
 * to a read-only banner — the row is still visible (auditors / peers
 * can read the discussion) but the textarea + Send button are gone.
 */
export function CommentThread({
  entityType,
  entityUuid,
  initial,
  canComment,
  currentUserId,
}: CommentThreadProps) {
  const [comments, setComments] = useState<Comment[]>(() => sortByCreated(initial));
  const [error, setError] = useState<BannerError | null>(null);
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<{
    uuid: string;
    body: string;
  } | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);

  // Channel subscription — every peer's write fans back in here.
  // Optimistic local writes use the same applier paths, so dedupe via
  // uuid keeps the timeline coherent even when both sources race.
  const upsertComment = useCallback((c: Comment) => {
    setComments((prev) => {
      const idx = prev.findIndex((row) => row.uuid === c.uuid);
      if (idx === -1) return sortByCreated([...prev, c]);
      const next = [...prev];
      next[idx] = c;
      return next;
    });
  }, []);

  const { connected, joinError, canComment: channelGrant } = useCommentChannel({
    entityType,
    entityUuid,
    onCreate: upsertComment,
    onUpdate: upsertComment,
    onDelete: upsertComment,
    disabled: false,
  });

  const refresh = useCallback(async () => {
    const res = await listCommentsAction(entityType, entityUuid);
    if (res.ok) {
      setComments(sortByCreated(res.items));
    }
  }, [entityType, entityUuid]);

  // Reconcile after reconnect — if the socket dropped, the controller
  // may have broadcast events we missed. Hard-refetch the timeline.
  const previouslyConnectedRef = useRef(false);
  useEffect(() => {
    if (connected) {
      if (previouslyConnectedRef.current) {
        // Was connected, dropped, and came back — refetch.
        void refresh();
      }
      previouslyConnectedRef.current = true;
    }
  }, [connected, refresh]);

  const effectiveCanComment = canComment && (channelGrant || !connected);
  const composerVisible = effectiveCanComment;

  const onSubmit = useCallback(() => {
    const body = draft.trim();
    if (!body) return;
    if (!effectiveCanComment) return;
    setError(null);
    startTransition(async () => {
      const res = await createCommentAction(entityType, entityUuid, body);
      if (res.ok) {
        // Optimistic upsert — the channel will fan it back in too;
        // upsert is idempotent on uuid so the duplicate is a no-op.
        upsertComment(res.comment);
        setDraft("");
        setComposerOpen(false);
      } else {
        setError({ detail: res.detail, code: res.code, debug: res.debug });
      }
    });
  }, [draft, effectiveCanComment, entityType, entityUuid, upsertComment]);

  const onSubmitEdit = useCallback(() => {
    if (!editing) return;
    const body = editing.body.trim();
    if (!body) return;
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
  }, [editing, entityType, entityUuid, upsertComment]);

  const onDelete = useCallback(
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
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-mono font-medium text-muted-foreground">
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

      <CardContent className="space-y-4">
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
            No comments yet. {effectiveCanComment ? "Start the discussion below." : ""}
          </div>
        ) : (
          <ol className="space-y-3">
            {comments.map((c) => (
              <CommentRow
                key={c.uuid}
                comment={c}
                isAuthor={c.author?.id === currentUserId}
                canEditOrDelete={effectiveCanComment}
                onEdit={() => setEditing({ uuid: c.uuid, body: c.body })}
                onDelete={() => onDelete(c.uuid)}
                editing={editing?.uuid === c.uuid ? editing : null}
                onEditChange={(body) =>
                  setEditing((cur) => (cur ? { ...cur, body } : cur))
                }
                onSubmitEdit={onSubmitEdit}
                onCancelEdit={() => setEditing(null)}
                pending={pending}
              />
            ))}
          </ol>
        )}

        {composerVisible ? (
          <Composer
            open={composerOpen}
            onOpen={() => setComposerOpen(true)}
            onClose={() => {
              setComposerOpen(false);
              setDraft("");
            }}
            value={draft}
            onChange={setDraft}
            onSubmit={onSubmit}
            pending={pending}
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

function CommentRow({
  comment,
  isAuthor,
  canEditOrDelete,
  onEdit,
  onDelete,
  editing,
  onEditChange,
  onSubmitEdit,
  onCancelEdit,
  pending,
}: {
  comment: Comment;
  isAuthor: boolean;
  canEditOrDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
  editing: { uuid: string; body: string } | null;
  onEditChange: (body: string) => void;
  onSubmitEdit: () => void;
  onCancelEdit: () => void;
  pending: boolean;
}) {
  const isDeleted = comment.body === "[deleted]";
  const when = new Date(comment.created_at);
  const editedAt = comment.edited_at ? new Date(comment.edited_at) : null;
  const showActions =
    !isDeleted &&
    isAuthor &&
    canEditOrDelete &&
    editing === null;

  return (
    <li
      className={cn(
        "group rounded-md border border-border/60 p-3",
        isDeleted && "bg-muted/30 opacity-70",
      )}
    >
      <div className="flex items-start gap-3">
        {comment.author ? (
          <UserAvatar
            name={comment.author.name}
            email={comment.author.email}
            avatar={comment.author.avatar}
            sizeClassName="size-7"
            fallbackClassName="text-[10px]"
          />
        ) : (
          <div className="size-7 rounded-full bg-muted" />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-xs font-medium text-foreground">
              {comment.author?.name ?? "Unknown user"}
            </span>
            <span
              className="text-[11px] text-muted-foreground/80"
              title={when.toLocaleString()}
            >
              {relativeTime(when)}
            </span>
            {editedAt && !isDeleted && (
              <span
                className="text-[11px] italic text-muted-foreground/60"
                title={`Edited ${editedAt.toLocaleString()}`}
              >
                edited
              </span>
            )}
            <div className="ml-auto flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              {showActions && (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={onEdit}
                    disabled={pending}
                    className="h-6 px-1.5 text-[11px]"
                  >
                    <Pencil className="mr-1 size-3" /> Edit
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={onDelete}
                    disabled={pending}
                    className="h-6 px-1.5 text-[11px] text-destructive hover:text-destructive"
                  >
                    <Trash2 className="mr-1 size-3" /> Delete
                  </Button>
                </>
              )}
            </div>
          </div>

          {editing ? (
            <div className="mt-2 space-y-2">
              <Textarea
                rows={3}
                value={editing.body}
                onChange={(e) => onEditChange(e.target.value)}
                maxLength={BODY_MAX}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    onSubmitEdit();
                  }
                  if (e.key === "Escape") onCancelEdit();
                }}
              />
              <div className="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={onCancelEdit}
                  disabled={pending}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={onSubmitEdit}
                  disabled={pending || editing.body.trim().length === 0}
                >
                  {pending ? (
                    <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                  ) : null}
                  Save
                </Button>
              </div>
            </div>
          ) : (
            <p
              className={cn(
                "mt-1 whitespace-pre-wrap break-words text-sm leading-snug",
                isDeleted && "italic text-muted-foreground",
              )}
            >
              {comment.body}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}

function Composer({
  open,
  onOpen,
  onClose,
  value,
  onChange,
  onSubmit,
  pending,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  pending: boolean;
}) {
  // On larger screens we always show the composer expanded. On small
  // screens it collapses to a tap-to-open button so it doesn't eat
  // a third of the viewport.
  return (
    <div className="border-t border-border/60 pt-4">
      {!open ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onOpen}
          className="w-full justify-start text-muted-foreground sm:hidden"
        >
          <MessageSquare className="mr-2 size-3.5" />
          Write a comment…
        </Button>
      ) : null}

      <div
        className={cn("space-y-2", !open && "hidden sm:block")}
      >
        <Textarea
          autoFocus={open}
          rows={3}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Write a comment… (Ctrl/Cmd+Enter to send)"
          maxLength={BODY_MAX}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              onSubmit();
            }
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">
            {value.length}/{BODY_MAX}
          </span>
          <div className="flex items-center gap-2">
            {open && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onClose}
                className="sm:hidden"
              >
                <X className="mr-1 size-3" />
                Cancel
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              onClick={onSubmit}
              disabled={pending || value.trim().length === 0}
            >
              {pending ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <Send className="mr-1.5 size-3.5" />
              )}
              Send
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ----- helpers ----------------------------------------------------

function sortByCreated(rows: Comment[]): Comment[] {
  return [...rows].sort((a, b) => {
    if (a.created_at === b.created_at) return a.id - b.id;
    return a.created_at < b.created_at ? -1 : 1;
  });
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

function relativeTime(d: Date): string {
  const diff = Date.now() - d.getTime();
  const sec = Math.round(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return d.toLocaleDateString();
}
