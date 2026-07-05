"use client";

// The composer surface: rich text editor + reply/edit chips + emoji
// picker + attachment button + send button. Wraps `RichComposer` and
// hands the parent a callback per user action.
//
// State machine (parent-owned; composer just renders it):
//
//                     ┌──────────────┐
//                     │   idle       │
//                     └──────────────┘
//              onReplyTo │  ▲ onCancelReply
//                        ▼  │
//                     ┌──────────────┐
//                     │   replying   │
//                     └──────────────┘
//               onEditPick │  ▲ onCancelEdit
//                          ▼  │
//                     ┌──────────────┐
//                     │   editing    │
//                     └──────────────┘
//
// Reply and Edit are mutually exclusive — the parent flips the mode
// and this component swaps the top chip. Send fires either
// `onSubmit` (normal / reply) or `onSubmitEdit` (editing) based on
// which chip is active.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  ArrowUp,
  Loader2,
  Paperclip,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  RichComposer,
  type ActiveFormats,
  type FormatKind,
  type RichComposerRef,
} from "./rich-composer";
import { FormattingToolbar } from "./formatting-toolbar";
import {
  EditComposerChip,
  ReplyComposerChip,
} from "./reply-chip";
import { EmojiPicker } from "./emoji-picker";
import {
  FileSendPreview,
  inferKind,
  type StagedFile,
} from "./file-send-preview";
import type { CommentParentRef } from "@/lib/comments/types";

const BODY_MAX = 4000;

export interface CommentComposerProps {
  disabled?: boolean;
  pending: boolean;
  /** Non-null while a reply is in progress. */
  replyTarget: CommentParentRef | null;
  onCancelReply: () => void;
  /** Non-null while an edit is in progress. */
  editTarget: { uuid: string; body: string } | null;
  onCancelEdit: () => void;
  /** Send a new (or reply) comment with the drafted markdown body. */
  onSubmit: (body: string) => void;
  /** Commit an edit to `editTarget.uuid`. */
  onSubmitEdit: (body: string) => void;
  /** Called when the user finalises a set of staged attachments. The
   *  parent decides whether to send them as a new comment or append
   *  to a fresh one it creates on the fly. */
  onSubmitFiles: (files: StagedFile[], caption: string) => Promise<void>;
}

export function CommentComposer({
  disabled = false,
  pending,
  replyTarget,
  onCancelReply,
  editTarget,
  onCancelEdit,
  onSubmit,
  onSubmitEdit,
  onSubmitFiles,
}: CommentComposerProps) {
  const composerRef = useRef<RichComposerRef | null>(null);
  const [textLength, setTextLength] = useState(0);
  const [selectionRect, setSelectionRect] = useState<DOMRect | null>(null);
  const [activeFormats, setActiveFormats] = useState<ActiveFormats>({
    bold: false,
    italic: false,
    strike: false,
    code: false,
  });
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [sendingFiles, setSendingFiles] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // When switching between "add a new comment" and "edit an existing
  // one" the composer body has to jump. Keyed on the edit target's
  // uuid so switching between two edits also flips the body.
  const editingUuid = editTarget?.uuid ?? null;
  useEffect(() => {
    if (editTarget) {
      composerRef.current?.setMarkdown(editTarget.body);
      setTextLength(composerRef.current?.getTextLength() ?? 0);
      // Defer focus so the browser has a chance to apply the DOM
      // update before we ask it to move the caret.
      requestAnimationFrame(() => composerRef.current?.focus());
    } else {
      composerRef.current?.clear();
      setTextLength(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingUuid]);

  // Focus on reply start so the user can type straight away.
  useEffect(() => {
    if (replyTarget) composerRef.current?.focus();
  }, [replyTarget]);

  const refreshSelection = useCallback(() => {
    const c = composerRef.current;
    if (!c) return;
    setSelectionRect(c.getSelectionRect());
    setActiveFormats(c.getActiveFormats());
  }, []);

  const applyFormat = useCallback(
    (format: FormatKind) => {
      composerRef.current?.toggleFormat(format);
      requestAnimationFrame(refreshSelection);
    },
    [refreshSelection],
  );

  const overCap = textLength > BODY_MAX;
  const hasBody = textLength > 0;
  const canSend = hasBody && !overCap && !pending && !disabled;

  const doSend = useCallback(() => {
    if (!canSend) return;
    const md = composerRef.current?.getMarkdown().trim() ?? "";
    if (!md) return;
    if (editTarget) {
      onSubmitEdit(md);
    } else {
      onSubmit(md);
      composerRef.current?.clear();
      setTextLength(0);
    }
  }, [canSend, editTarget, onSubmit, onSubmitEdit]);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Enter to send, Shift+Enter for newline.
    if (
      e.key === "Enter" &&
      !e.shiftKey &&
      !(e.nativeEvent as { isComposing?: boolean }).isComposing
    ) {
      e.preventDefault();
      doSend();
      return;
    }

    if (e.key === "Escape") {
      if (editTarget) onCancelEdit();
      else if (replyTarget) onCancelReply();
      return;
    }

    // Markdown shortcuts.
    const meta = e.metaKey || e.ctrlKey;
    if (!meta) return;
    const key = e.key.toLowerCase();
    if (key === "b" && !e.shiftKey) {
      e.preventDefault();
      applyFormat("bold");
    } else if (key === "i" && !e.shiftKey) {
      e.preventDefault();
      applyFormat("italic");
    } else if (e.shiftKey && key === "x") {
      e.preventDefault();
      applyFormat("strike");
    } else if (e.shiftKey && key === "m") {
      e.preventDefault();
      applyFormat("code");
    }
  };

  const insertAtCaret = (text: string) => {
    composerRef.current?.focus();
    document.execCommand("insertText", false, text);
  };

  const handleFilesStaged = (files: File[]) => {
    if (files.length === 0) return;
    const next: StagedFile[] = files.map((file) => {
      const kind = inferKind(file);
      const previewable =
        kind === "image" || kind === "gif" || kind === "video";
      return {
        id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        kind,
        previewUrl: previewable ? URL.createObjectURL(file) : null,
      };
    });
    setStaged((prev) => [...prev, ...next]);
    setPreviewOpen(true);
  };

  // Revoke object URLs when the preview closes / staged list shrinks
  // so we don't leak blob refs.
  useEffect(() => {
    return () => {
      staged.forEach((s) => {
        if (s.previewUrl) URL.revokeObjectURL(s.previewUrl);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const removeStaged = (id: string) => {
    setStaged((prev) => {
      const gone = prev.find((s) => s.id === id);
      if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl);
      return prev.filter((s) => s.id !== id);
    });
  };

  const submitStaged = async (caption: string) => {
    if (staged.length === 0) return;
    setSendingFiles(true);
    try {
      await onSubmitFiles(staged, caption);
      staged.forEach((s) => {
        if (s.previewUrl) URL.revokeObjectURL(s.previewUrl);
      });
      setStaged([]);
      setPreviewOpen(false);
    } finally {
      setSendingFiles(false);
    }
  };

  const handleFileButton = () => {
    fileInputRef.current?.click();
  };

  const showChip = editTarget || replyTarget;

  return (
    <div className="rounded-b-xl border-t border-border bg-card">
      {editTarget ? (
        <EditComposerChip
          snippet={truncate(editTarget.body, 100)}
          onCancel={onCancelEdit}
        />
      ) : replyTarget ? (
        <ReplyComposerChip target={replyTarget} onCancel={onCancelReply} />
      ) : null}

      <div className="flex items-end gap-1.5 px-3 py-2 sm:px-3 sm:py-2.5">
        <div className="relative min-w-0 flex-1">
          <RichComposer
            ref={composerRef}
            placeholder="Write a comment…"
            ariaLabel="Comment body"
            disabled={disabled || pending}
            onFilesPasted={handleFilesStaged}
            onInput={() => {
              setTextLength(composerRef.current?.getTextLength() ?? 0);
              refreshSelection();
            }}
            onSelectionChange={refreshSelection}
            onKeyDown={handleKeyDown}
            className={cn(
              "block min-h-[36px] max-h-[156px] w-full overflow-y-auto rounded-2xl border bg-background px-3 py-1.5 text-sm leading-snug text-foreground",
              "[&_strong]:font-semibold",
              "[&_em]:italic",
              "[&_s]:line-through",
              "[&_code]:rounded [&_code]:bg-foreground/[0.08] [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.92em]",
              overCap
                ? "border-destructive focus-within:border-destructive"
                : "border-border focus-within:border-brand/60",
              (disabled || pending) && "opacity-60",
            )}
          />

          <FormattingToolbar
            rect={selectionRect}
            active={activeFormats}
            onApply={applyFormat}
          />

          {textLength >= BODY_MAX * 0.8 && (
            <span
              className={cn(
                "pointer-events-none absolute bottom-1 right-2 rounded-full bg-card/90 px-1.5 py-0.5 text-[10px] font-bold tabular-nums backdrop-blur",
                overCap ? "text-destructive" : "text-muted-foreground",
              )}
              aria-live="polite"
            >
              {overCap
                ? `${textLength - BODY_MAX} over`
                : `${BODY_MAX - textLength} left`}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5 pb-0.5">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              const list = e.target.files;
              if (list) handleFilesStaged(Array.from(list));
              // Reset so choosing the same file twice fires change again.
              e.target.value = "";
            }}
          />

          <button
            type="button"
            onClick={handleFileButton}
            disabled={disabled || pending}
            aria-label="Attach file"
            title="Attach file"
            className={cn(
              "inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              (disabled || pending) && "opacity-50 cursor-not-allowed",
            )}
          >
            <Paperclip className="size-4" aria-hidden />
          </button>

          <EmojiPicker
            triggerAriaLabel="Insert emoji"
            onSelect={insertAtCaret}
            closeOnSelect={false}
          />

          {hasBody || editTarget ? (
            <Button
              type="button"
              onClick={doSend}
              disabled={!canSend && !editTarget}
              aria-label={editTarget ? "Save edit" : "Send"}
              title={editTarget ? "Save edit" : "Send"}
              className={cn(
                "size-9 shrink-0 rounded-full p-0",
                canSend
                  ? "bg-brand text-brand-foreground hover:bg-brand/90"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ArrowUp className="size-4" />
              )}
            </Button>
          ) : null}
        </div>
      </div>

      <FileSendPreview
        open={previewOpen}
        onOpenChange={(o) => {
          if (!o && !sendingFiles) {
            // Cancelled — drop the whole staged batch.
            staged.forEach((s) => {
              if (s.previewUrl) URL.revokeObjectURL(s.previewUrl);
            });
            setStaged([]);
          }
          setPreviewOpen(o);
        }}
        files={staged}
        onRemove={removeStaged}
        onSend={submitStaged}
        pending={sendingFiles}
      />
    </div>
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
