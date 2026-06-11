"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Lock, LockKeyhole } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type {
  CollabPeer,
  JoinError,
} from "@/lib/realtime/use-live-form";

// Shared collab plumbing for the seven /settings/company sub-forms.
// All seven join `form:company:1` and share presence/cursors. Each
// form still owns its own draft state and renders its own Card, so
// these helpers stay narrow: cursor-anchor wiring, a creator banner,
// and the JoinErrorCard.

interface FormAnchor {
  attach: (el: HTMLDivElement | null) => void;
  size: { w: number; h: number };
  onMouseMove: (e: React.MouseEvent<HTMLDivElement>) => void;
  onMouseLeave: () => void;
}

/**
 * Attach the cursor anchor + ResizeObserver + mouse handlers to a Card
 * (or any block element). The returned `ref` is a callback ref so the
 * caller never has to spread a RefObject through JSX (React 19's
 * react-hooks/refs rule treats reading `.current` during render as an
 * error). `size` feeds the RemoteCursor overlay so peer positions map
 * to the local element's actual pixels.
 */
export function useFormCursorAnchor(
  setCursor: (x: number, y: number) => void,
  hideCursor: () => void,
): FormAnchor {
  const elRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const attach = useCallback((el: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    elRef.current = el;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setSize({ w: rect.width, h: rect.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    observerRef.current = observer;
  }, []);

  useEffect(
    () => () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    },
    [],
  );

  useEffect(() => () => hideCursor(), [hideCursor]);

  const onMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = elRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      setCursor(x, y);
    },
    [setCursor],
  );

  return {
    attach,
    size,
    onMouseMove,
    onMouseLeave: hideCursor,
  };
}

export function CreatorLockBanner({
  creator,
  action = "save",
}: {
  creator: CollabPeer | null;
  action?: string;
}) {
  if (!creator) return null;
  return (
    <div className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
      <Lock className="mt-0.5 size-3.5 shrink-0" />
      <span>
        Only{" "}
        <span className="font-medium text-foreground">{creator.name}</span> can{" "}
        {action} from this room. Your edits sync to them live.
      </span>
    </div>
  );
}

export function JoinErrorCard({ error }: { error: JoinError }) {
  const config = {
    form_full: {
      icon: AlertCircle,
      tone: "amber" as const,
      title: "Form is at capacity",
      detail: error.limit
        ? `Up to ${error.limit} people can edit company settings at once. Wait for someone to leave, then refresh.`
        : "Wait for someone to leave, then refresh.",
    },
    forbidden: {
      icon: LockKeyhole,
      tone: "muted" as const,
      title: "You can't edit here",
      detail:
        "Ask an admin for the `company.edit` permission to join this form.",
    },
    bad_topic: {
      icon: AlertCircle,
      tone: "destructive" as const,
      title: "Unknown form",
      detail: "We couldn't find this form. The link may have been malformed.",
    },
    unknown: {
      icon: AlertCircle,
      tone: "destructive" as const,
      title: "Couldn't open the form",
      detail: "Something went wrong on our end. Please try again.",
    },
  }[error.reason];

  const Icon = config.icon;
  const toneClass =
    config.tone === "amber"
      ? "border-amber-500/30 bg-amber-50/40 dark:bg-amber-950/20"
      : config.tone === "destructive"
        ? "border-destructive/30 bg-destructive/[0.03]"
        : "border-border/60 bg-muted/30";
  const iconClass =
    config.tone === "amber"
      ? "text-amber-600 dark:text-amber-400"
      : config.tone === "destructive"
        ? "text-destructive"
        : "text-muted-foreground";

  return (
    <Card className={cn("border", toneClass)}>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-background">
          <Icon className={cn("size-6", iconClass)} />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-semibold">{config.title}</p>
          <p className="text-xs text-muted-foreground">{config.detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}
