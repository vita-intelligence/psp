"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { messageFor } from "@/lib/errors/codes";
import type { PermissionTemplate } from "@/lib/types";
import {
  AlertCircle,
  Check,
  Loader2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

interface ApplyTemplateButtonProps {
  /** Codes already ticked in the matrix — used to mark templates as
   *  "fully applied" so admins can see at-a-glance which ones won't
   *  add anything new. */
  currentPermissions: string[];
  /** Called with the template's codes when the admin picks one.
   *  Parent does the union into matrix state. Pure additive — never
   *  removes a code that was already ticked. */
  onApply: (codes: string[]) => void;
  disabled?: boolean;
}

interface FetchState {
  status: "idle" | "loading" | "ready" | "error";
  templates: PermissionTemplate[];
  error: string | null;
}

/**
 * "Apply template" popover that sits next to the Admin toggle on the
 * user-access form. Fetches `/api/roles` lazily on first open, caches
 * the result for the popover's lifetime. Clicking an item unions its
 * codes into the matrix — no replace, no destructive overwrite, so a
 * user who already had unique perms keeps them.
 */
export function ApplyTemplateButton({
  currentPermissions,
  onApply,
  disabled = false,
}: ApplyTemplateButtonProps) {
  const [open, setOpen] = useState(false);
  const [fetchState, setFetchState] = useState<FetchState>({
    status: "idle",
    templates: [],
    error: null,
  });

  useEffect(() => {
    // Refetch on every open — templates list is bounded (≤50 rows
    // realistically) so the cost is negligible, and it sidesteps the
    // Strict Mode trap where a "fetched once" guard wedges state at
    // "loading" when the first run gets cancelled by the dev-mode
    // unmount simulation. The latest fetch wins via cancellation.
    if (!open) return;

    let cancelled = false;
    setFetchState({ status: "loading", templates: [], error: null });

    (async () => {
      try {
        const res = await fetch("/api/roles", { cache: "no-store" });
        if (cancelled) return;
        if (!res.ok) {
          let body: { error?: string; detail?: string } = {};
          try {
            body = await res.json();
          } catch {
            // body wasn't JSON
          }
          if (cancelled) return;
          setFetchState({
            status: "error",
            templates: [],
            error: messageFor(body.error, body.detail),
          });
          return;
        }
        const data = (await res.json()) as {
          items: PermissionTemplate[];
        };
        if (cancelled) return;
        setFetchState({ status: "ready", templates: data.items, error: null });
      } catch {
        if (cancelled) return;
        setFetchState({
          status: "error",
          templates: [],
          error: "Couldn't load templates. Please try again.",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  const currentSet = new Set(currentPermissions);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          className="shrink-0"
        >
          <Sparkles className="mr-1.5 size-3.5" />
          Apply template
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2">
        <div className="px-2 pt-1 pb-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Apply template
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground/80">
            Adds the template&apos;s permissions to the matrix. Existing
            ticks stay — nothing is removed.
          </p>
        </div>

        {fetchState.status === "loading" && (
          <div className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading templates…
          </div>
        )}

        {fetchState.status === "error" && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs text-destructive">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <span>{fetchState.error}</span>
          </div>
        )}

        {fetchState.status === "ready" && fetchState.templates.length === 0 && (
          <div className="rounded-md border border-dashed border-border/60 px-3 py-6 text-center text-xs text-muted-foreground">
            <ShieldCheck className="mx-auto mb-1.5 size-5 text-muted-foreground/60" />
            No templates yet. Create one from{" "}
            <span className="font-medium text-foreground">
              Settings → Templates
            </span>
            .
          </div>
        )}

        {fetchState.status === "ready" && fetchState.templates.length > 0 && (
          <ul className="max-h-72 space-y-0.5 overflow-y-auto">
            {fetchState.templates.map((t) => {
              const newCodes = t.permissions.filter((c) => !currentSet.has(c));
              const fullyApplied = newCodes.length === 0 && t.permissions.length > 0;

              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onApply(t.permissions);
                      setOpen(false);
                    }}
                    disabled={fullyApplied}
                    className="flex w-full items-start gap-2 rounded-sm px-2 py-2 text-left transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
                  >
                    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
                      {fullyApplied ? (
                        <Check className="size-3.5" />
                      ) : (
                        <ShieldCheck className="size-3.5" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{t.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {fullyApplied
                          ? "All permissions already granted"
                          : `+${newCodes.length} new · ${t.permissions.length} total`}
                      </p>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
