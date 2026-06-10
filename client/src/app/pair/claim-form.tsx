"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  initialCode: string;
  hasValidPrefill: boolean;
}

interface ClaimResponse {
  ok: boolean;
  redirect?: string;
  detail?: string;
}

/**
 * Claim form: submits via `fetch()` (NOT a classic form POST) because
 * iOS Safari shows a confirmation interstitial on HTTP form submits
 * to LAN dev servers, blocking the flow entirely. `fetch()` bypasses
 * that interstitial, and the route handler still sets the device
 * cookie reliably via Set-Cookie on the JSON response.
 */
export function ClaimForm({ initialCode, hasValidPrefill }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const [code, setCode] = useState(initialCode);
  const [label, setLabel] = useState("");
  const [platform, setPlatform] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Auto-suggest the label + platform from the device UA — gives the
  // operator something sensible to hit Enter on.
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    setLabel(detectLabel(navigator.userAgent));
    setPlatform(detectPlatform());
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const fd = new FormData(e.currentTarget);
      const res = await fetch("/api/device/claim", {
        method: "POST",
        body: fd,
        // Same-origin so cookies flow normally; Safari persists the
        // Set-Cookie on the JSON response.
        credentials: "same-origin",
      });
      const data = (await res.json()) as ClaimResponse;

      if (data.ok && data.redirect) {
        // Hard navigation so middleware re-runs with the freshly-set
        // device cookie and shows /m.
        window.location.assign(data.redirect);
        return;
      }

      setError(data.detail ?? "Pairing failed.");
      setSubmitting(false);
    } catch {
      setError("Network error. Check your Wi-Fi and try again.");
      setSubmitting(false);
    }
  }

  return (
    // suppressHydrationWarning silences password-manager / Chrome
    // autofill attribute injection between SSR and hydration — known
    // false positive.
    <form
      ref={formRef}
      onSubmit={onSubmit}
      className="space-y-3"
      suppressHydrationWarning
    >
      <div className="space-y-1.5">
        <Label htmlFor="pair-code">Pairing code</Label>
        <Input
          id="pair-code"
          name="code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="ABC123"
          maxLength={6}
          className="font-mono uppercase tracking-[0.4em]"
          autoCapitalize="characters"
          autoComplete="off"
          autoFocus={!hasValidPrefill}
          required
          suppressHydrationWarning
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="pair-label">Device name</Label>
        <Input
          id="pair-label"
          name="label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Max's iPhone"
          maxLength={80}
          autoFocus={hasValidPrefill}
          required
          suppressHydrationWarning
        />
        <p className="text-xs text-muted-foreground">
          This is what shows up in your laptop's device list and on every
          action this device performs.
        </p>
      </div>

      <input type="hidden" name="platform" value={platform} />

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <Button
        type="submit"
        className="w-full"
        disabled={submitting || !code.trim() || !label.trim()}
      >
        {submitting && <Loader2 className="mr-1.5 size-4 animate-spin" />}
        Pair this device
      </Button>
    </form>
  );
}

function detectPlatform(): "ios" | "android" | "web" | "other" {
  if (typeof navigator === "undefined") return "web";
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (/android/.test(ua)) return "android";
  if (/mac os x|macintosh|windows nt|linux/.test(ua)) return "web";
  return "other";
}

function detectLabel(ua: string): string {
  const lower = ua.toLowerCase();
  if (/iphone/.test(lower)) return "iPhone";
  if (/ipad/.test(lower)) return "iPad";
  if (/android/.test(lower) && /mobile/.test(lower)) return "Android phone";
  if (/android/.test(lower)) return "Android tablet";
  if (/macintosh/.test(lower)) return "Mac";
  if (/windows/.test(lower)) return "Windows PC";
  if (/linux/.test(lower)) return "Linux PC";
  return "Mobile device";
}
