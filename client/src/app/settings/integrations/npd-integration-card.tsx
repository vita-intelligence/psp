"use client";

import { useState, useTransition } from "react";
import { Beaker, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  testNpdIntegration,
  updateNpdIntegration,
} from "@/lib/npd-integration/actions";
import type { NpdIntegrationConfig } from "@/lib/npd-integration/types";

interface Props {
  readonly initialConfig: NpdIntegrationConfig | null;
}

/**
 * Settings card for the NPD reverse-integration.
 *
 * Mirrors NPD's PSP-integration settings card in shape:
 *
 *   * ``Enabled`` — master toggle. When off, the R&D column on
 *     ``/projects`` is hidden even if base URL + token are captured.
 *   * ``Base URL`` — where NPD lives. Required when enabled.
 *   * ``Token``   — bearer NPD accepts. Blank submission means
 *                   "don't change" — the BE preserves the stored
 *                   value. Replaced means "rotate to this value".
 *   * ``Test``    — server-to-server ping. Reports a live count on
 *                   success and a short reason on failure.
 */
export function NpdIntegrationCard({ initialConfig }: Props) {
  const config = initialConfig ?? {
    enabled: false,
    base_url: null,
    has_token: false,
  };

  const [enabled, setEnabled] = useState(config.enabled);
  const [baseUrl, setBaseUrl] = useState(config.base_url ?? "");
  const [tokenInput, setTokenInput] = useState("");
  const [hasToken, setHasToken] = useState(config.has_token);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<
    { ok: true; count: number } | { ok: false; reason: string } | null
  >(null);
  const [isSaving, startSave] = useTransition();
  const [isTesting, startTest] = useTransition();

  const onSave = () => {
    setSaveError(null);
    startSave(async () => {
      try {
        const next = await updateNpdIntegration({
          enabled,
          base_url: baseUrl.trim(),
          //: Blank string tells the BE "keep whatever's stored"; a
          //: real string overwrites.
          token: tokenInput.trim() === "" ? null : tokenInput.trim(),
        });
        setEnabled(next.enabled);
        setBaseUrl(next.base_url ?? "");
        setHasToken(next.has_token);
        setTokenInput("");
      } catch (error) {
        setSaveError(
          error instanceof Error ? error.message : "Save failed",
        );
      }
    });
  };

  const onTest = () => {
    setTestResult(null);
    startTest(async () => {
      const result = await testNpdIntegration();
      if (result.ok) {
        setTestResult({
          ok: true,
          count: result.in_development_count ?? 0,
        });
      } else {
        setTestResult({
          ok: false,
          reason: result.reason ?? "unknown",
        });
      }
    });
  };

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <Beaker className="size-4 text-fuchsia-600 dark:text-fuchsia-400" />
              R&amp;D (NPD) integration
            </CardTitle>
            <CardDescription>
              Verifies PSP can reach NPD (vita-cff). NPD pushes each
              formulation into PSP as a draft customer order via{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-[10px]">
                /api/integration/customer-orders/sync
              </code>
              , landing in the R&amp;D column of{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-[10px]">
                /projects
              </code>
              . Base URL + bearer token only power the Test-connection
              probe below. Blank the token to keep the stored value.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* --------------- Enabled toggle --------------- */}
        <div className="flex items-start gap-3">
          <Checkbox
            id="npd-enabled"
            checked={enabled}
            onCheckedChange={(checked) => setEnabled(checked === true)}
          />
          <div className="min-w-0 space-y-0.5">
            <Label htmlFor="npd-enabled" className="cursor-pointer">
              Enabled
            </Label>
            <p className="text-[11px] text-muted-foreground">
              Off = the R&amp;D column stays hidden regardless of the
              other fields. Useful for pausing the integration without
              wiping the token.
            </p>
          </div>
        </div>

        {/* --------------- Base URL --------------- */}
        <div className="space-y-1.5">
          <Label htmlFor="npd-base-url">Base URL</Label>
          <Input
            id="npd-base-url"
            type="url"
            placeholder="https://npd.vita.internal"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            disabled={isSaving}
          />
          <p className="text-[11px] text-muted-foreground">
            Origin only — the endpoint paths are hard-coded in the PSP
            client.
          </p>
        </div>

        {/* --------------- Token --------------- */}
        <div className="space-y-1.5">
          <Label htmlFor="npd-token">Bearer token</Label>
          <Input
            id="npd-token"
            type="password"
            placeholder={
              hasToken ? "•••••••••• (retype to rotate)" : "Paste the NPD token"
            }
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            autoComplete="off"
            disabled={isSaving}
          />
          <p className="text-[11px] text-muted-foreground">
            {hasToken
              ? "A token is stored. Blank submit = keep it. Retyping rotates to the new value."
              : "No token stored yet. Required before the integration can be enabled."}
          </p>
        </div>

        {/* --------------- Buttons + status --------------- */}
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Button size="sm" onClick={onSave} disabled={isSaving}>
            {isSaving ? "Saving…" : "Save"}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={onTest}
            disabled={isTesting || !enabled || !hasToken}
            title={
              !enabled
                ? "Enable the integration first"
                : !hasToken
                  ? "Save a token before testing"
                  : undefined
            }
          >
            {isTesting ? "Testing…" : "Test connection"}
          </Button>
          {testResult?.ok ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-3.5" />
              Connected · {testResult.count} in-development project
              {testResult.count === 1 ? "" : "s"}
            </span>
          ) : testResult && !testResult.ok ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
              <XCircle className="size-3.5" />
              {formatTestReason(testResult.reason)}
            </span>
          ) : null}
        </div>

        {saveError ? (
          <p className="text-xs text-destructive">{saveError}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}


function formatTestReason(raw: string): string {
  switch (raw) {
    case "invalid_token":
      return "Token rejected by NPD";
    case "cannot_connect":
      return "Can't reach NPD at that URL";
    case "timeout":
      return "NPD didn't respond in time";
    case "malformed_response":
      return "NPD replied but with an unexpected shape";
    case "not_configured":
      return "Enable + save the config first";
    default:
      return raw.startsWith("unexpected_status_")
        ? `NPD returned ${raw.replace("unexpected_status_", "HTTP ")}`
        : "Test failed";
  }
}
