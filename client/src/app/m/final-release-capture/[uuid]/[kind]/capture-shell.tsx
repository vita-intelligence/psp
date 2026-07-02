"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  RefreshCw,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  FILE_KIND_HINT,
  FILE_KIND_LABEL,
  type FinalReleaseFileKind,
} from "@/lib/production-final-release/types";

interface Props {
  releaseUuid: string;
  kind: FinalReleaseFileKind;
}

/**
 * Full-screen mobile page that goes straight into the camera (via
 * `capture="environment"`) so the operator can snap the required
 * photo and see it uploaded to the release form. Pushed here from
 * the desktop release form's "Send to device" button on each file
 * row.
 */
export function CaptureShell({ releaseUuid, kind }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(0);

  // Auto-open the camera on landing so the operator doesn't have to
  // tap anything before shooting. iOS + Android both trigger the
  // hardware camera picker on `capture="environment"`.
  useEffect(() => {
    const t = window.setTimeout(() => {
      inputRef.current?.click();
    }, 250);
    return () => window.clearTimeout(t);
  }, []);

  async function handleFile(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("kind", kind);
      form.append("file", file);
      const res = await fetch(
        `/api/production/final-releases/${encodeURIComponent(releaseUuid)}/files`,
        { method: "POST", body: form },
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { detail?: string };
        toast.error(err.detail ?? "Couldn't upload the photo.");
        return;
      }
      setUploaded((n) => n + 1);
      toast.success("Photo attached to the release form.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-muted/30">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <Link
            href="/m"
            aria-label="Back"
            className="-ml-2 rounded-md p-1.5 text-muted-foreground"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Final release · Take photo
            </p>
            <h1 className="truncate text-sm font-semibold">
              {FILE_KIND_LABEL[kind]}
            </h1>
          </div>
        </div>
      </header>

      <main className="flex-1 space-y-4 px-4 py-4">
        <section className="rounded-lg border border-border/60 bg-card p-4">
          <p className="text-sm text-muted-foreground">
            {FILE_KIND_HINT[kind]}
          </p>
        </section>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
        />

        <Button
          type="button"
          className="w-full"
          size="lg"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? (
            <>
              <RefreshCw className="mr-2 size-5 animate-spin" />
              Uploading…
            </>
          ) : uploaded > 0 ? (
            <>
              <Camera className="mr-2 size-5" />
              Take another
            </>
          ) : (
            <>
              <Camera className="mr-2 size-5" />
              Open camera
            </>
          )}
        </Button>

        {uploaded > 0 && (
          <section className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800 dark:text-emerald-200">
              <CheckCircle2 className="size-4" />
              {uploaded} photo{uploaded === 1 ? "" : "s"} attached
            </div>
            <p className="mt-1 text-xs text-emerald-800/90 dark:text-emerald-200/90">
              The desktop release form updates automatically. Take another
              shot if you need multi-panel coverage, otherwise head back to
              the queue.
            </p>
          </section>
        )}

        <Button asChild variant="outline" className="w-full" size="lg">
          <Link href="/m">
            <Upload className="mr-2 size-5" />
            Done — back to home
          </Link>
        </Button>
      </main>
    </div>
  );
}
