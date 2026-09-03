"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, X } from "lucide-react";
import { realPhotoUrl } from "@/components/dev-skip-photo-button";

/**
 * Last-known photo of a lot. Rendered next to the floor-plan on
 * pickup detail screens so the worker can spot the actual box /
 * pallet on the shelf, not just match a label.
 *
 * Renders a labelled empty-state tile when the lot has never been
 * photographed, and swaps to the same tile if the file fails to
 * load (deleted blob, auth blip) — never the browser's broken-image
 * icon, which looks identical to a "no photo on file" state to a
 * worker.
 *
 * Uses a plain `<img>` (not `next/image`) on purpose — the photo
 * comes from a session-gated proxy route, can be any aspect ratio
 * (operator's hand-held snap), and on iOS Safari the `fill` +
 * unoptimized combo collapsed to a hairline when the parent's flex
 * context squeezed it.
 */
export function LastSeenPhoto({
  url,
  caption,
}: {
  url: string | null | undefined;
  caption?: string;
}) {
  const [errored, setErrored] = useState(false);
  const resolved = realPhotoUrl(url);
  const empty = !resolved || errored;

  if (empty) {
    return (
      <div className="flex h-44 w-full flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-border/60 bg-muted/40 px-3 text-center text-muted-foreground">
        <Camera className="size-5 opacity-60" />
        <p className="text-[11px] font-medium">No photo on file yet</p>
        <p className="text-[10px] opacity-70">
          The next worker to move this lot will capture one.
        </p>
      </div>
    );
  }

  return (
    <a
      href={resolved!}
      target="_blank"
      rel="noreferrer"
      className="block w-full overflow-hidden rounded-md border border-border/60 bg-muted"
      title={caption ?? "Tap to enlarge"}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={resolved!}
        alt={caption ?? "Last known photo of this lot"}
        className="block h-44 w-full object-cover"
        onError={() => setErrored(true)}
      />
    </a>
  );
}

/**
 * Wraps a `LastSeenPhoto` in a card with a header label. Used in
 * pickup-style flows directly under the floor plan.
 */
export function LastSeenPhotoCard({
  url,
  caption,
}: {
  url: string | null | undefined;
  caption?: string;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card p-3">
      <p className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
        Last known photo of this lot
      </p>
      <LastSeenPhoto url={url} caption={caption} />
    </div>
  );
}

/**
 * Fullscreen photo viewer. Sits on top of everything (z-[100]) with a
 * near-opaque backdrop; closes on: X button tap, backdrop tap, or
 * Escape. Locks body scroll while open so the underlying page can't
 * scroll under the operator's finger on mobile. Rendered inline
 * (not portalled) — the parent decides when to mount.
 *
 * Mobile-first: safe-area padding on the top-right close button so it
 * clears iOS notches, and the image is `object-contain` so a tall
 * portrait phone snap doesn't get cropped on a wide desktop viewport.
 */
export function PhotoLightbox({
  url,
  caption,
  onClose,
}: {
  url: string;
  caption?: string;
  onClose: () => void;
}) {
  // `mounted` gate keeps createPortal safe under SSR — the server pass
  // has no `document`, so we render null on the first client tick and
  // then re-render with the portal after mount. Without this, the tree
  // that React tries to hydrate doesn't match the server output and
  // you get the "hydration mismatch" console error.
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  if (!mounted) return null;

  // Portal to body so the fixed overlay escapes any nested interactive
  // ancestor (rows with `role="button"`, tables, etc.) and any
  // transformed / z-indexed stacking context that would otherwise
  // clip it. Also avoids the browser's "interactive-inside-
  // interactive" a11y warning even though HTML technically allows
  // <button> inside <div role="button">.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={caption ?? "Photo viewer"}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-sm"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close photo"
        className="absolute right-3 top-3 z-10 inline-flex size-11 items-center justify-center rounded-full bg-black/80 text-white shadow-lg ring-1 ring-white/40 transition-colors hover:bg-black active:bg-black"
        style={{
          top: "max(0.75rem, env(safe-area-inset-top))",
          right: "max(0.75rem, env(safe-area-inset-right))",
        }}
      >
        <X className="size-5" strokeWidth={2.5} />
      </button>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={caption ?? "Photo"}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92dvh] max-w-[96vw] object-contain"
      />

      {caption && (
        <p
          className="absolute inset-x-0 text-center text-xs text-white/70"
          style={{
            bottom: "max(0.75rem, env(safe-area-inset-bottom))",
          }}
        >
          {caption}
        </p>
      )}
    </div>,
    document.body,
  );
}
