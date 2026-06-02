"use client";

import {
  useConnectionState,
  deriveStatus,
} from "@/lib/realtime/connection-store";
import { cn } from "@/lib/utils";

/**
 * Small status pill — replaces the lonely floating dot. Carries a
 * label so the meaning is obvious without hover/tooltip. Mobile shows
 * just the dot (label collapses below `sm:`).
 */
export function ConnectionPill() {
  const status = useConnectionState((s) =>
    deriveStatus(s.navigatorOnline, s.socketOpen, s.hasEverConnected),
  );

  const config = {
    online: {
      label: "Live",
      dot: "bg-emerald-500",
      pulse: "bg-emerald-400/60",
      tone: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900/50",
      animated: true,
    },
    reconnecting: {
      label: "Reconnecting",
      dot: "bg-amber-500",
      pulse: "bg-amber-400/60",
      tone: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-900/50",
      animated: true,
    },
    offline: {
      label: "Offline",
      dot: "bg-destructive",
      pulse: "",
      tone: "bg-destructive/10 text-destructive border-destructive/30",
      animated: false,
    },
  }[status];

  return (
    <span
      role="status"
      aria-label={`${config.label} — realtime connection status`}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium",
        config.tone,
      )}
    >
      <span className="relative inline-flex size-2 items-center justify-center">
        {config.animated && (
          <span
            className={cn(
              "absolute inline-flex size-full animate-ping rounded-full",
              config.pulse,
            )}
          />
        )}
        <span
          className={cn(
            "relative inline-flex size-2 rounded-full",
            config.dot,
          )}
        />
      </span>
      <span className="hidden sm:inline">{config.label}</span>
    </span>
  );
}
