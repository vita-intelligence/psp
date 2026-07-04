"use client";

// Preview dialog shown before staged files land on the server. Lets
// the user drop a caption, remove individual files, or bail out
// entirely. Multi-file friendly — sends fire in sequence so a single
// failure doesn't lose the whole batch.

import { useEffect, useState } from "react";
import { FileText, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { CommentFileKind } from "@/lib/comments/types";

export interface StagedFile {
  id: string;
  file: File;
  kind: CommentFileKind;
  /** Object URL for image previews. Populated for `image` / `gif` /
   *  `video` kinds; null for `file` / `audio` so we don't leak URLs
   *  we don't render. Revoked in the effect cleanup. */
  previewUrl: string | null;
}

export function FileSendPreview({
  open,
  onOpenChange,
  files,
  onRemove,
  onSend,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  files: StagedFile[];
  onRemove: (id: string) => void;
  onSend: (caption: string) => void;
  pending: boolean;
}) {
  const [caption, setCaption] = useState("");

  // Reset the caption whenever the dialog reopens.
  useEffect(() => {
    if (open) setCaption("");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Send {files.length === 1 ? "attachment" : `${files.length} attachments`}</DialogTitle>
          <DialogDescription>
            Review before posting. Captions and attachments are shared with
            everyone who can read this discussion.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-72 space-y-2 overflow-y-auto">
          {files.map((f) => (
            <StagedFileRow
              key={f.id}
              file={f}
              onRemove={() => onRemove(f.id)}
              disabled={pending}
            />
          ))}
        </div>

        <Textarea
          rows={2}
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Add a caption…"
          disabled={pending}
        />

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => onSend(caption)}
            disabled={pending || files.length === 0}
          >
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StagedFileRow({
  file,
  onRemove,
  disabled,
}: {
  file: StagedFile;
  onRemove: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-2">
      <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-background">
        {file.previewUrl && (file.kind === "image" || file.kind === "gif") ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={file.previewUrl}
            alt={file.file.name}
            className="size-full object-cover"
          />
        ) : (
          <FileText className="size-4 text-muted-foreground" aria-hidden />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-foreground">
          {file.file.name}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {formatBytes(file.file.size)} · {file.kind}
        </p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={`Remove ${file.file.name}`}
        className={cn(
          "inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground",
          disabled && "opacity-50",
        )}
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Infer a `CommentFileKind` from a File's mime + name. Kept out of
 *  the row so the composer's `handleFilesStaged` can reuse it. */
export function inferKind(file: File): CommentFileKind {
  const mime = file.type;
  if (mime === "image/gif" || file.name.toLowerCase().endsWith(".gif")) {
    return "gif";
  }
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "file";
}
