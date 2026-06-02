"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Wordmark } from "@/components/brand/wordmark";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw } from "lucide-react";

/**
 * Catch-all for unhandled React render errors inside the app. Next's
 * convention is to expose `reset()` so the user can retry the
 * boundary's children without a full reload.
 *
 * We deliberately don't show `error.message` to the user — Next's dev
 * server already exposes stack traces in the overlay, and in
 * production we don't want to leak internals. Once we wire a real
 * telemetry sink (Sentry, etc.) this is where we'd push the report.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // TODO(telemetry): forward to error tracker when one is wired up.
    // For now we just log to the browser console so dev catches it.
    console.error("Unhandled render error:", error);
  }, [error]);

  return (
    <div className="flex flex-1 flex-col">
      <header className="px-4 pt-6 sm:px-8 sm:pt-8">
        <Wordmark />
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-12 sm:py-20">
        <Card className="w-full max-w-md border-border/60 shadow-lg shadow-foreground/[0.03]">
          <CardContent className="p-7 text-center space-y-4">
            <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="size-7 text-destructive" />
            </div>
            <div className="space-y-1.5">
              <h1 className="text-lg font-semibold">Something broke</h1>
              <p className="text-sm text-muted-foreground">
                An unexpected error stopped this page from rendering. You
                can try again — if it keeps happening, refresh the page.
              </p>
              {error.digest && (
                <p className="pt-1 text-xs text-muted-foreground">
                  Reference:{" "}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
                    {error.digest}
                  </code>
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                onClick={() => reset()}
                className="h-11 flex-1"
                type="button"
              >
                <RefreshCw className="mr-1.5 size-4" />
                Try again
              </Button>
              <Button asChild variant="outline" className="h-11 flex-1">
                <Link href="/">Go home</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
