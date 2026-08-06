"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { FileText, Loader2, Printer } from "lucide-react";

interface Props {
  /** Card header label (e.g. "Product specification sheet"). */
  title: string;
  /** Same-origin proxy URL that returns rendered HTML. */
  src: string;
  /** Text under the spinner while the frame loads. */
  loadingLabel?: string;
  /** Header icon; defaults to a plain document glyph. */
  icon?: ReactNode;
  /** Open on mount when true; defaults to collapsed. */
  defaultOpen?: boolean;
}

/**
 * Collapsible NPD-artefact iframe embed. Used for both the product
 * specification sheet and the product validation sheet — anywhere
 * PSP needs to display an NPD-rendered HTML document inside its own
 * page shell.
 *
 * Behaviour:
 *   * Lazy-mount — iframe isn't attached to the DOM until the operator
 *     hits Show, so pages listing many MOs / lots don't fire N proxy
 *     requests just to render collapsed rows.
 *   * Keep-alive — once mounted the iframe stays in the tree. Hide is
 *     a CSS toggle, so re-opening the section is instant (no refetch).
 *   * Mount-race hardened — the load-state comes from React's `onLoad`
 *     prop (bound at commit), backed by a `readyState` poll on the
 *     ref. Without the poll a cached response can complete BEFORE the
 *     onLoad handler is wired, leaving the spinner spinning forever.
 *   * Auto-size — reads `contentDocument.body.scrollHeight` after
 *     load and observes for reflows so the iframe grows to fit its
 *     A4 content instead of scrolling internally.
 */
export function NpdSheetEmbed({
  title,
  src,
  loadingLabel = "Loading sheet…",
  icon,
  defaultOpen = false,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [hasOpened, setHasOpened] = useState(defaultOpen);
  const [loading, setLoading] = useState(true);
  const [height, setHeight] = useState<number>(1123);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (pollRef.current !== null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, []);

  const measure = () => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc?.body) return;
    const next = Math.max(
      doc.body.scrollHeight,
      doc.documentElement?.scrollHeight ?? 0,
    );
    if (next > 0) setHeight(next);
  };

  const finishLoad = () => {
    setLoading(false);
    measure();
    const doc = iframeRef.current?.contentDocument;
    if (doc?.body && typeof ResizeObserver !== "undefined") {
      observerRef.current?.disconnect();
      const observer = new ResizeObserver(measure);
      observer.observe(doc.body);
      observerRef.current = observer;
    }
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  // Ref callback: the moment the iframe DOM node exists, kick off a
  // readyState poll. If the browser races React (cached response
  // finishes before onLoad is bound), the poll catches it within a
  // few hundred ms and clears the spinner. Cleared once onLoad fires
  // OR the poll flips it — whichever wins.
  const attachIframe = (el: HTMLIFrameElement | null) => {
    iframeRef.current = el;
    if (!el) return;
    if (pollRef.current !== null) return;
    pollRef.current = window.setInterval(() => {
      const doc = el.contentDocument;
      if (doc?.readyState === "complete") finishLoad();
    }, 150);
  };

  function toggle() {
    setOpen((v) => {
      if (!v) setHasOpened(true);
      return !v;
    });
  }

  return (
    <section className="rounded-lg border border-border/60 bg-card">
      <div className="flex w-full items-center justify-between gap-3 px-5 py-3">
        <button
          type="button"
          onClick={toggle}
          className="flex flex-1 items-center gap-2 text-left"
        >
          {icon ?? <FileText className="size-4 text-muted-foreground" />}
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        </button>
        <div className="flex items-center gap-2">
          {open && (
            <button
              type="button"
              onClick={() => {
                const win = iframeRef.current?.contentWindow;
                if (win) {
                  win.focus();
                  win.print();
                }
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border/60 bg-background px-2.5 text-xs font-medium hover:bg-muted"
            >
              <Printer className="size-3.5" />
              Print
            </button>
          )}
          <button
            type="button"
            onClick={toggle}
            className="text-xs text-muted-foreground"
          >
            {open ? "Hide" : "Show"}
          </button>
        </div>
      </div>

      {hasOpened && (
        <div
          className="border-t border-border/60 bg-white px-2 py-8 sm:px-6"
          hidden={!open}
        >
          <div className="relative mx-auto w-[210mm] max-w-full overflow-hidden bg-white">
            {loading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-white text-xs text-muted-foreground">
                <Loader2 className="mr-2 size-4 animate-spin" />
                {loadingLabel}
              </div>
            )}
            <iframe
              ref={attachIframe}
              src={src}
              title={title}
              scrolling="no"
              onLoad={finishLoad}
              onError={() => setLoading(false)}
              className="block w-full border-0 bg-white"
              style={{ height: `${height}px` }}
            />
          </div>
        </div>
      )}
    </section>
  );
}
