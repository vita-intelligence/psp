"use client";

import { useState } from "react";
import Image from "next/image";
import { Camera } from "lucide-react";

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
 */
export function LastSeenPhoto({
  url,
  caption,
}: {
  url: string | null | undefined;
  caption?: string;
}) {
  const [errored, setErrored] = useState(false);
  const empty = !url || errored;

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
      href={url}
      target="_blank"
      rel="noreferrer"
      className="relative block h-44 w-full overflow-hidden rounded-md border border-border/60 bg-muted"
      title={caption ?? "Tap to enlarge"}
    >
      <Image
        src={url}
        alt={caption ?? "Last known photo of this lot"}
        fill
        sizes="(max-width: 600px) 90vw, 400px"
        className="object-cover"
        unoptimized
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
