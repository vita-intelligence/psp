"use client";

// Renders the timeline of comments as messenger-style bubbles with:
//
//   - Consecutive-author grouping (5-min window) so a burst from one
//     person collapses into a single visual block.
//   - Day dividers ("Today"/"Yesterday"/date) between blocks.
//   - Nested replies indented under their parent so a discussion
//     tree stays readable without going full Reddit.
//
// Everything upstream is flat (a single `Comment[]`) — we compute the
// tree in this component so callers don't have to think about it.

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { CommentBubble } from "./comment-bubble";
import type { Comment } from "@/lib/comments/types";

interface Props {
  comments: Comment[];
  currentUserId: number;
  canReply: boolean;
  canReact: boolean;
  onReply: (parent: Comment) => void;
  onEdit: (comment: Comment) => void;
  onDelete: (commentUuid: string) => void;
  onReact: (commentUuid: string, emoji: string) => void;
}

interface TreeNode {
  comment: Comment;
  children: TreeNode[];
}

const GROUP_GAP_MS = 5 * 60 * 1000;

export function MessageStream({
  comments,
  currentUserId,
  canReply,
  canReact,
  onReply,
  onEdit,
  onDelete,
  onReact,
}: Props) {
  // Soft-deleted comments vanish from the timeline entirely — no
  // tombstone. Their children get promoted to top level by the tree
  // builder's orphan-fallback so a thread doesn't lose its replies.
  const visible = useMemo(
    () => comments.filter((c) => c.body !== "[deleted]"),
    [comments],
  );
  const tree = useMemo(() => buildTree(visible), [visible]);

  const jumpToParent = (parentUuid: string) => {
    if (typeof document === "undefined") return;
    const el = document.querySelector<HTMLElement>(
      `[data-comment-uuid="${cssEscape(parentUuid)}"]`,
    );
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    // Brief flash so the eye lands on the right bubble.
    el.animate(
      [
        { boxShadow: "0 0 0 3px var(--brand)" },
        { boxShadow: "0 0 0 0 var(--brand)" },
      ],
      { duration: 900, easing: "ease-out" },
    );
  };

  if (tree.length === 0) return null;

  // Walk the top level; day dividers are inserted between top-level
  // nodes only (nested replies inherit their parent's day).
  let lastDay: string | null = null;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {tree.map((node) => {
        const day = new Date(node.comment.created_at).toDateString();
        const showDayDivider = day !== lastDay;
        lastDay = day;

        return (
          <div key={node.comment.uuid} className="flex flex-col gap-1">
            {showDayDivider && <DayDivider date={node.comment.created_at} />}
            <ThreadNode
              node={node}
              depth={0}
              currentUserId={currentUserId}
              canReply={canReply}
              canReact={canReact}
              onReply={onReply}
              onEdit={onEdit}
              onDelete={onDelete}
              onReact={onReact}
              onJumpToParent={jumpToParent}
            />
          </div>
        );
      })}
    </div>
  );
}

function ThreadNode({
  node,
  depth,
  currentUserId,
  canReply,
  canReact,
  onReply,
  onEdit,
  onDelete,
  onReact,
  onJumpToParent,
}: {
  node: TreeNode;
  depth: number;
  currentUserId: number;
  canReply: boolean;
  canReact: boolean;
  onReply: (parent: Comment) => void;
  onEdit: (comment: Comment) => void;
  onDelete: (commentUuid: string) => void;
  onReact: (commentUuid: string, emoji: string) => void;
  onJumpToParent: (parentUuid: string) => void;
}) {
  // Build a flat list of (comment) for this node + its direct
  // (leaf) children, then group consecutive same-author entries so a
  // burst from one person collapses into a single visual block.
  const flat = useMemo(
    () => flattenBranch(node),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [node.comment.uuid, node.children.length],
  );
  const grouped = useMemo(() => groupSiblings(flat), [flat]);

  return (
    <div
      className={cn(
        "flex flex-col gap-1",
        depth > 0 && "ml-6 mt-1 border-l border-border/50 pl-3",
      )}
    >
      {grouped.map((group) =>
        group.messages.map((item, mIdx) => {
          const isLastInGroup = mIdx === group.messages.length - 1;
          const c = item.comment;
          const isAuthor = c.author?.id === currentUserId;
          return (
            <CommentBubble
              key={c.uuid}
              comment={c}
              isSelf={isAuthor}
              showAvatar={isLastInGroup}
              canReply={canReply}
              canReact={canReact}
              canModify={isAuthor && canReply /* canReply = write cap */}
              onReply={() => onReply(c)}
              onEdit={() => onEdit(c)}
              onDelete={() => onDelete(c.uuid)}
              onReact={(emoji) => onReact(c.uuid, emoji)}
              onJumpToParent={onJumpToParent}
            />
          );
        }),
      )}

      {/* Children rendered recursively. The parent's direct siblings
          are already inlined above via `flat`; nested replies at
          depth+1 recurse here. */}
      {node.children
        .filter((child) => child.children.length > 0)
        .map((child) => (
          <ThreadNode
            key={"deep-" + child.comment.uuid}
            node={child}
            depth={depth + 1}
            currentUserId={currentUserId}
            canReply={canReply}
            canReact={canReact}
            onReply={onReply}
            onEdit={onEdit}
            onDelete={onDelete}
            onReact={onReact}
            onJumpToParent={onJumpToParent}
          />
        ))}

    </div>
  );
}

// ── Grouping ───────────────────────────────────────────────────────

interface FlatItem {
  comment: Comment;
}

interface Group {
  authorKey: string;
  messages: FlatItem[];
}

function flattenBranch(node: TreeNode): FlatItem[] {
  // Head (the parent) + its direct children in chronological order.
  // Nested grandchildren are handled recursively — they render inside
  // ThreadNode's own recursive block, not here.
  const out: FlatItem[] = [{ comment: node.comment }];
  for (const child of node.children) {
    // Include leaf children (no grandchildren) inline so a simple
    // "reply → reply" chain reads as a single indented block. Deeper
    // branches recurse.
    if (child.children.length === 0) {
      out.push({ comment: child.comment });
    }
  }
  return out;
}

function groupSiblings(items: FlatItem[]): Group[] {
  const groups: Group[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    const authorKey = item.comment.author?.id
      ? String(item.comment.author.id)
      : "anon";
    if (!last) {
      groups.push({ authorKey, messages: [item] });
      continue;
    }
    const lastMsg = last.messages[last.messages.length - 1];
    const gap =
      new Date(item.comment.created_at).getTime() -
      new Date(lastMsg.comment.created_at).getTime();
    if (last.authorKey === authorKey && gap < GROUP_GAP_MS) {
      last.messages.push(item);
    } else {
      groups.push({ authorKey, messages: [item] });
    }
  }
  return groups;
}

// ── Tree builder ───────────────────────────────────────────────────

function buildTree(comments: Comment[]): TreeNode[] {
  const sorted = [...comments].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  const byId = new Map<number, TreeNode>();
  const roots: TreeNode[] = [];
  for (const c of sorted) {
    const node: TreeNode = { comment: c, children: [] };
    byId.set(c.id, node);
    if (c.parent_comment_id != null) {
      const parent = byId.get(c.parent_comment_id);
      if (parent) {
        parent.children.push(node);
        continue;
      }
      // Parent came after us in the list (defensive) or was deleted —
      // demote to a root so it still renders.
    }
    roots.push(node);
  }
  return roots;
}

// ── Day divider ────────────────────────────────────────────────────

function DayDivider({ date }: { date: string }) {
  return (
    <div
      role="separator"
      className="my-1 flex items-center justify-center gap-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
    >
      <span className="h-px flex-1 bg-border" />
      <span>{formatDay(date)}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - 1,
  );
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year:
      d.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

// Safe wrapper around CSS.escape — polyfill for older browsers falls
// back to a permissive strip that's still safe for our uuid inputs.
function cssEscape(s: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(s);
  }
  return s.replace(/[^a-zA-Z0-9_-]/g, (m) => `\\${m}`);
}
