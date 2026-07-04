"use client";

// Inline attachment renderer used inside a comment bubble. Branches on
// `kind` to pick the right presentation:
//
//   image / gif   → clickable thumbnail; click opens lightbox.
//   video         → native <video> with controls.
//   audio         → native <audio> playback (voice notes use the same
//                   surface for now — waveform rendering is a follow-up).
//   file          → filename + size + download icon in a card.
//
// Every branch reserves its own aspect ratio when width/height are
// known so the bubble doesn't jump when the media resolves.
//
// Note: no per-file remove affordance. Removing an attachment is done
// by deleting the whole comment via the bubble's 3-dot menu, which
// cascades to files server-side (comment_files FK on_delete: :delete_all).

import { useState } from "react";
import { Download, FileText } from "lucide-react";
import { Lightbox } from "./lightbox";
import { cn } from "@/lib/utils";
import type { CommentFile } from "@/lib/comments/types";

export function FileAttachment({
  file,
  isSelf,
}: {
  file: CommentFile;
  isSelf: boolean;
}) {
  const [lightboxOpen, setLightboxOpen] = useState(false);

  if (file.kind === "image" || file.kind === "gif") {
    // Aspect ratio hint keeps the bubble stable while the image
    // decodes. Fall back to auto when the backend didn't record dims
    // (rare but possible for pre-existing uploads).
    const aspect =
      file.width_px && file.height_px
        ? `${file.width_px} / ${file.height_px}`
        : undefined;
    return (
      <>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setLightboxOpen(true);
          }}
          className={cn(
            "block max-w-full overflow-hidden rounded-lg border transition-shadow hover:shadow-md",
            isSelf ? "border-brand-foreground/20" : "border-border",
          )}
          style={{ aspectRatio: aspect }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={file.url}
            alt={file.filename}
            loading="lazy"
            className="block h-full max-h-72 w-auto object-cover"
          />
        </button>
        <Lightbox
          open={lightboxOpen}
          onOpenChange={setLightboxOpen}
          src={file.url}
          alt={file.filename}
        />
      </>
    );
  }

  if (file.kind === "video") {
    return (
      <div
        className={cn(
          "overflow-hidden rounded-lg border",
          isSelf ? "border-brand-foreground/20" : "border-border",
        )}
      >
        <video
          src={file.url}
          controls
          preload="metadata"
          className="block max-h-72 w-full bg-black"
        />
      </div>
    );
  }

  if (file.kind === "audio") {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border px-2 py-2",
          isSelf
            ? "border-brand-foreground/20 bg-brand-foreground/[0.06]"
            : "border-border bg-background",
        )}
      >
        <audio
          src={file.url}
          controls
          preload="metadata"
          className="h-8 max-w-full flex-1"
        />
      </div>
    );
  }

  // Generic file card — icon, filename, size, download link.
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-lg border p-2 pr-3",
        isSelf
          ? "border-brand-foreground/20 bg-brand-foreground/[0.06]"
          : "border-border bg-background",
      )}
    >
      <div
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-md",
          isSelf ? "bg-brand-foreground/15" : "bg-muted",
        )}
      >
        <FileText
          className={cn(
            "size-4",
            isSelf ? "text-brand-foreground" : "text-muted-foreground",
          )}
          aria-hidden
        />
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "truncate text-[13px] font-medium",
            isSelf ? "text-brand-foreground" : "text-foreground",
          )}
        >
          {file.filename}
        </p>
        <p
          className={cn(
            "text-[11px]",
            isSelf ? "text-brand-foreground/70" : "text-muted-foreground",
          )}
        >
          {formatBytes(file.byte_size)}
        </p>
      </div>
      <a
        href={file.url}
        download={file.filename}
        onClick={(e) => e.stopPropagation()}
        aria-label={`Download ${file.filename}`}
        className={cn(
          "inline-flex size-8 shrink-0 items-center justify-center rounded-full transition-colors",
          isSelf
            ? "text-brand-foreground/80 hover:bg-brand-foreground/15 hover:text-brand-foreground"
            : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground",
        )}
      >
        <Download className="size-4" aria-hidden />
      </a>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
