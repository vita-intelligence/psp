"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Loader2 } from "lucide-react";

interface Props {
  moUuid: string;
}

/**
 * Collapsible spec sheet card for the MO detail page. Renders NPD's
 * server-rendered spec HTML in an iframe, sized to fit its content.
 * Same auth chain as the Output-QC embed: browser → Next proxy →
 * Phoenix → NPD, all server-to-server bearers.
 */
export function MOSpecSheet({ moUuid }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [height, setHeight] = useState(1123);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const frame = iframeRef.current;
    if (!frame) return;

    let observer: ResizeObserver | null = null;
    const measure = () => {
      const doc = frame.contentDocument;
      if (!doc?.body) return;
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
  }, [open]);

  const src = `/api/production/manufacturing-orders/${encodeURIComponent(
    moUuid,
  )}/npd-spec.html`;

  return (
    <section className="rounded-lg border border-border/60 bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <FileText className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold tracking-tight">
            Product specification sheet
          </h2>
        </div>
        <span className="text-xs text-muted-foreground">
          {open ? "Hide" : "Show"}
        </span>
      </button>

      {open && (
        <div className="border-t border-border/60 bg-neutral-100 px-2 py-8 dark:bg-neutral-900 sm:px-6">
          <div className="relative mx-auto w-[210mm] max-w-full overflow-hidden bg-white shadow-lg ring-1 ring-black/10">
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
      )}
    </section>
  );
}
