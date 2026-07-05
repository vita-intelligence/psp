"use client";

// One rendered comment. Handles own vs peer alignment, timestamp
// footer, edited badge, quoted parent chip, file attachments,
// reactions bar, and hover-reveal action buttons.
//
// Delete confirmation lives here — an inline confirm state rather
// than a modal so the flow is snappy for the common case (an author
// wants to remove their own typo).

import { useState } from "react";
import {
  MoreHorizontal,
  Pencil,
  Reply,
  Trash2,
} from "lucide-react";
import { UserAvatar } from "@/components/users/user-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { FormattedText } from "./formatted-text";
import { ParentQuoteChip } from "./reply-chip";
import { ReactionsBar } from "./reactions-bar";
import { FileAttachment } from "./file-attachment";
import { EmojiPicker } from "./emoji-picker";
import type { Comment } from "@/lib/comments/types";

export interface CommentBubbleProps {
  comment: Comment;
  isSelf: boolean;
  /** Show the avatar (bottom of the group). Non-last-in-group bubbles
   *  render a spacer so the bubble column stays aligned. */
  showAvatar: boolean;
  canReply: boolean;
  canReact: boolean;
  canModify: boolean;
  onReply: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onReact: (emoji: string) => void;
  onJumpToParent: (parentUuid: string) => void;
}

export function CommentBubble({
  comment,
  isSelf,
  showAvatar,
  canReply,
  canReact,
  canModify,
  onReply,
  onEdit,
  onDelete,
  onReact,
  onJumpToParent,
}: CommentBubbleProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const isDeleted = comment.body === "[deleted]";
  const editedAt = comment.edited_at ? new Date(comment.edited_at) : null;
  const createdAt = new Date(comment.created_at);
  const activeEmoji =
    comment.reactions.find((r) => r.own_reacted)?.emoji ?? null;

  return (
    <div
      className={cn(
        "group/bubble flex min-w-0 items-end gap-1.5",
        isSelf ? "flex-row-reverse" : "flex-row",
      )}
    >
      {/* Avatar slot — shown only on the last bubble of a group.
          Non-last-in-group gets a spacer so the bubble column stays
          aligned. Self bubbles skip the avatar entirely; they hug the
          right edge. */}
      {!isSelf &&
        (showAvatar ? (
          comment.author ? (
            <UserAvatar
              name={comment.author.name}
              email={comment.author.email}
              avatar={comment.author.avatar}
              sizeClassName="size-7"
              fallbackClassName="text-[10px]"
            />
          ) : (
            <div className="size-7 rounded-full bg-muted" />
          )
        ) : (
          <span className="size-7 shrink-0" aria-hidden />
        ))}

      {/* Bubble */}
      <div
        data-comment-uuid={comment.uuid}
        className={cn(
          "relative min-w-0 max-w-[85%] break-words rounded-2xl px-3 py-2 text-[14px] leading-snug sm:max-w-[75%]",
          isSelf
            ? "bg-brand text-brand-foreground"
            : "border border-border bg-muted text-foreground shadow-sm",
          isDeleted && "opacity-70",
        )}
      >
        {!isSelf && showAvatar && comment.author && (
          <p
            className={cn(
              "mb-0.5 text-[11px] font-semibold",
              "text-foreground/85",
            )}
          >
            {comment.author.name}
          </p>
        )}

        {comment.parent && (
          <ParentQuoteChip
            parent={comment.parent}
            isSelf={isSelf}
            onJump={() => onJumpToParent(comment.parent!.uuid)}
          />
        )}

        {/* Attachments (rendered above the body so a caption sits
            beneath the media, matching most messenger conventions). */}
        {comment.files.length > 0 && (
          <div className="mb-1 space-y-1.5">
            {comment.files.map((f) => (
              <FileAttachment key={f.uuid} file={f} isSelf={isSelf} />
            ))}
          </div>
        )}

        {isDeleted ? (
          <p
            className={cn(
              "italic",
              isSelf ? "text-brand-foreground/70" : "text-muted-foreground",
            )}
          >
            [deleted]
          </p>
        ) : (
          comment.body && (
            <p className="whitespace-pre-wrap">
              <FormattedText
                text={comment.body}
                isSelf={isSelf}
                linkClassName={
                  isSelf
                    ? "text-brand-foreground/95 font-medium"
                    : "text-sky-500"
                }
              />
            </p>
          )
        )}

        {/* Footer: timestamp + edited badge */}
        <div
          className={cn(
            "mt-1 flex items-center justify-end gap-1.5 text-[10px] font-medium",
            isSelf ? "text-brand-foreground/70" : "text-muted-foreground",
          )}
        >
          {editedAt && !isDeleted && (
            <span
              className="italic opacity-80"
              title={`Edited ${editedAt.toLocaleString()}`}
            >
              edited
            </span>
          )}
          <span title={createdAt.toLocaleString()}>
            {formatClock(createdAt)}
          </span>
        </div>

        {/* Reactions bar */}
        <ReactionsBar
          reactions={comment.reactions}
          isSelf={isSelf}
          disabled={!canReact}
          onToggle={onReact}
        />
      </div>

      {/* Hover-reveal actions — desktop only. Reply, react, and a
          menu with edit / delete (author-only) */}
      {!isDeleted && (
        <div
          className={cn(
            "flex shrink-0 items-center gap-0.5 self-center",
            "opacity-0 transition-opacity duration-150 group-hover/bubble:opacity-100 focus-within:opacity-100",
          )}
        >
          {canReact && (
            <EmojiPicker
              triggerAriaLabel="React"
              activeEmoji={activeEmoji}
              onSelect={onReact}
              align={isSelf ? "end" : "start"}
              buttonClassName="size-7"
            />
          )}
          {canReply && (
            <button
              type="button"
              onClick={onReply}
              aria-label="Reply"
              title="Reply"
              className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Reply className="size-3.5" aria-hidden />
            </button>
          )}
          {canModify && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="More"
                  className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <MoreHorizontal className="size-3.5" aria-hidden />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align={isSelf ? "end" : "start"}
                className="w-40"
              >
                <DropdownMenuItem onClick={onEdit}>
                  <Pencil className="size-3.5" aria-hidden />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setConfirmingDelete(true)}
                >
                  <Trash2 className="size-3.5" aria-hidden />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}

      {/* Inline delete confirmation. Renders as a floating card next
          to the bubble so we don't move focus off the page. */}
      {confirmingDelete && (
        <div
          role="alertdialog"
          className="absolute z-50 mt-14 flex items-center gap-2 rounded-md border border-border bg-popover px-2 py-1.5 text-[12px] shadow-lg"
        >
          <span className="text-foreground">Delete this comment?</span>
          <button
            type="button"
            onClick={() => setConfirmingDelete(false)}
            className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-foreground/[0.05]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onDelete();
              setConfirmingDelete(false);
            }}
            className="rounded bg-destructive px-1.5 py-0.5 font-medium text-destructive-foreground hover:brightness-95"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

function formatClock(d: Date): string {
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (sameDay) return `${hh}:${mm}`;
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${hh}:${mm}`;
}
