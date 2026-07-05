"use client";

// Two flavours of "quote a comment":
//
//   ReplyComposerChip — sits ABOVE the composer while a reply is in
//     progress. Cancels the pending parent reference.
//
//   ParentQuoteChip — rendered INSIDE a child comment bubble. Tap
//     jumps the discussion to the parent (caller wires the scroll +
//     flash behaviour).

import { Pencil, Reply, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CommentParentRef } from "@/lib/comments/types";

export function ReplyComposerChip({
  target,
  onCancel,
}: {
  target: CommentParentRef;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-start gap-2 border-b border-border/60 px-3 py-2">
      <div className="min-w-0 flex-1 rounded-md border-l-2 border-brand bg-brand/10 px-2 py-1">
        <p className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.1em] text-brand">
          <Reply className="size-3" aria-hidden />
          Replying to
        </p>
        <p className="truncate text-[13px] font-semibold text-foreground">
          {target.author_name}
        </p>
        <p className="truncate text-[12px] text-muted-foreground">
          {target.snippet}
        </p>
      </div>
      <button
        type="button"
        onClick={onCancel}
        aria-label="Cancel reply"
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}

export function EditComposerChip({
  snippet,
  onCancel,
}: {
  snippet: string;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-start gap-2 border-b border-border/60 px-3 py-2">
      <div className="flex min-w-0 flex-1 items-start gap-2 rounded-md border-l-2 border-brand bg-brand/10 px-2 py-1">
        <Pencil className="mt-0.5 size-3.5 shrink-0 text-brand" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-brand">
            Editing message
          </p>
          <p className="truncate text-[12px] text-muted-foreground">
            {snippet}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onCancel}
        aria-label="Cancel edit"
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}

export function ParentQuoteChip({
  parent,
  isSelf,
  onJump,
}: {
  parent: CommentParentRef;
  isSelf: boolean;
  onJump: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onJump();
      }}
      className={cn(
        "mb-1.5 block w-full rounded-md border-l-2 px-2 py-1 text-left text-[12px] transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isSelf
          ? "border-brand-foreground/40 bg-brand-foreground/[0.08] hover:bg-brand-foreground/[0.14]"
          : "border-brand bg-brand/10 hover:bg-brand/20",
      )}
    >
      <p
        className={cn(
          "truncate font-semibold leading-tight",
          isSelf ? "text-brand-foreground/90" : "text-foreground",
        )}
      >
        {parent.author_name}
      </p>
      <p
        className={cn(
          "truncate leading-snug",
          isSelf ? "text-brand-foreground/75" : "text-muted-foreground",
        )}
      >
        {parent.snippet}
      </p>
    </button>
  );
}
