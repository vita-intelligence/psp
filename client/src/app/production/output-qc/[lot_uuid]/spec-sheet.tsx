"use client";

import { useEffect, useRef, useState } from "react";
import { Info, Loader2 } from "lucide-react";
import type { OutputQcEntry } from "@/lib/production/types";

interface Props {
  entry: OutputQcEntry;
}

/**
 * NPD spec sheet embedded via same-origin proxy.
 *
 * The iframe points at PSP's own `/api/production/output-qc/:lot_uuid/npd-spec.html`.
 * PSP's controller server-side-fetches NPD's rendered HTML using the
 * shared integration bearer, then streams it back under PSP's own
 * session — no public link, no leaked NPD URL, no token in the DOM.
 *
 * Result: QA sees the identical document NPD renders (actives,
 * nutrition, amino acids, excipients, ingredients declaration,
 * signatures, workflow history) — not a PSP re-implementation that
 * could drift.
 */
export function SpecSheet({ entry }: Props) {
  const source = entry.finished_product_spec_source;
  const ownItemName =
    entry.lot.item?.name ?? entry.mo?.item?.name ?? "This item";
  const parentItemName =
    source.kind === "parent" ? source.item_name : null;

  const [loading, setLoading] = useState(true);
  // A4 short-side (210 mm) at 96 dpi ≈ 794 px. Everything renders on
  // a fixed-width paper; height auto-grows to fit content (spec sheets
  // easily exceed one page, esp. with nutrition + amino acid tables).
  const [height, setHeight] = useState<number>(1123); // A4 long side
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const src = `/api/production/output-qc/${encodeURIComponent(
    entry.lot.uuid,
  )}/npd-spec.html`;

  // Same-origin iframe (routed through the PSP proxy) means we can
  // read the rendered body's scrollHeight to size the frame exactly.
  // ResizeObserver keeps it in sync if content reflows.
  useEffect(() => {
    const frame = iframeRef.current;
    if (!frame) return;

    let observer: ResizeObserver | null = null;

    const measure = () => {
      const doc = frame.contentDocument;
      if (!doc || !doc.body) return;
      const next = Math.max(
        doc.body.scrollHeight,
        doc.documentElement?.scrollHeight ?? 0,
      );
      if (next > 0) setHeight(next);
    };

    const onLoad = () => {
      setLoading(false);
      measure();
      const doc = frame.contentDocument;
      if (doc?.body && typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(measure);
        observer.observe(doc.body);
      }
    };

    frame.addEventListener("load", onLoad);
    return () => {
      frame.removeEventListener("load", onLoad);
      observer?.disconnect();
    };
  }, []);

  return (
    <div className="space-y-3">
      {source.kind === "parent" && (
        <div className="flex items-start gap-2 rounded-lg border border-sky-500/30 bg-sky-500/5 p-3 text-xs">
          <Info className="mt-0.5 size-4 shrink-0 text-sky-600 dark:text-sky-400" />
          <div className="space-y-0.5">
            <p className="font-medium">
              Parent product spec inherited from{" "}
              <span className="font-mono">
                {parentItemName ?? "parent MO"}
              </span>
            </p>
            <p className="text-muted-foreground">
              <span className="font-medium">{ownItemName}</span> is a
              semi-finished intermediate. The sheet below is the finished
              product it feeds into — use it as the reference target for
              this lot.
            </p>
          </div>
        </div>
      )}

      <div className="relative bg-white">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white text-xs text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" />
            Loading NPD spec sheet…
          </div>
        )}
        <iframe
          ref={iframeRef}
          src={src}
          title="NPD product specification sheet"
          className="block w-full border-0 bg-white"
          style={{ height: `${height}px` }}
        />
      </div>
    </div>
  );
}
