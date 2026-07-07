"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Copy, Plus, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge-mini";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  mintIntegrationToken,
  revokeIntegrationToken,
} from "@/lib/integrations/actions";
import type {
  IntegrationScope,
  IntegrationToken,
} from "@/lib/integrations/types";

interface Props {
  initialTokens: IntegrationToken[];
  knownScopes: IntegrationScope[];
}

export function IntegrationsClient({ initialTokens, knownScopes }: Props) {
  const [tokens, setTokens] = useState(initialTokens);
  const [mintOpen, setMintOpen] = useState(false);
  const [mintName, setMintName] = useState("");
  const [mintScopes, setMintScopes] = useState<Set<IntegrationScope>>(new Set());
  const [mintError, setMintError] = useState<string | null>(null);
  const [rawToken, setRawToken] = useState<string | null>(null);
  const [copiedFlash, setCopiedFlash] = useState(false);

  const [revokeTarget, setRevokeTarget] = useState<IntegrationToken | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const [pending, startTransition] = useTransition();

  const openMint = () => {
    setMintName("");
    setMintScopes(new Set());
    setMintError(null);
    setRawToken(null);
    setMintOpen(true);
  };

  const toggleScope = (scope: IntegrationScope) => {
    setMintScopes((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  };

  const submitMint = () => {
    setMintError(null);

    if (!mintName.trim()) {
      setMintError("Name is required.");
      return;
    }
    if (mintScopes.size === 0) {
      setMintError("At least one scope is required.");
      return;
    }

    startTransition(async () => {
      try {
        const result = await mintIntegrationToken({
          name: mintName.trim(),
          scopes: Array.from(mintScopes),
        });
        setTokens((prev) => [result.integration_token, ...prev]);
        setRawToken(result.raw_token);
      } catch (err) {
        setMintError(err instanceof Error ? err.message : "Failed to mint token");
      }
    });
  };

  const copyRawToken = async () => {
    if (!rawToken) return;
    try {
      await navigator.clipboard.writeText(rawToken);
      setCopiedFlash(true);
      window.setTimeout(() => setCopiedFlash(false), 1500);
    } catch {
      // clipboard blocked — user can still select + copy manually
    }
  };

  const closeMintDialog = () => {
    setMintOpen(false);
    setRawToken(null);
    setCopiedFlash(false);
  };

  const submitRevoke = () => {
    if (!revokeTarget) return;
    setRevokeError(null);

    const target = revokeTarget;
    startTransition(async () => {
      try {
        const result = await revokeIntegrationToken({
          uuid: target.uuid,
          reason: revokeReason.trim() || undefined,
        });
        setTokens((prev) =>
          prev.map((t) => (t.uuid === target.uuid ? result.integration_token : t)),
        );
        setRevokeTarget(null);
        setRevokeReason("");
      } catch (err) {
        setRevokeError(err instanceof Error ? err.message : "Failed to revoke");
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openMint}>
          <Plus className="mr-2 h-4 w-4" />
          Mint token
        </Button>
      </div>

      {tokens.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          No integration tokens yet. Mint one to give an external system
          access to PSP.
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Prefix</TableHead>
                <TableHead>Scopes</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokens.map((t) => (
                <TableRow key={t.uuid}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {t.prefix}…
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {t.scopes.map((s) => (
                        <Badge key={s} tone="muted">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    {t.is_active ? (
                      <Badge tone="emerald">Active</Badge>
                    ) : (
                      <Badge tone="destructive">Revoked</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {t.last_used_at
                      ? new Date(t.last_used_at).toLocaleString()
                      : "never"}
                  </TableCell>
                  <TableCell className="text-right">
                    {t.is_active && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setRevokeReason("");
                          setRevokeError(null);
                          setRevokeTarget(t);
                        }}
                      >
                        <ShieldOff className="mr-1 h-4 w-4" />
                        Revoke
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Mint dialog — flips to success view once raw token comes back */}
      <Dialog
        open={mintOpen}
        onOpenChange={(open) => (open ? setMintOpen(true) : closeMintDialog())}
      >
        <DialogContent>
          {rawToken ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  Copy your token now
                </DialogTitle>
                <DialogDescription>
                  This is the only time PSP will show the raw token. Store it
                  in your consumer's secret manager. If you lose it, revoke
                  this row and mint a new one.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <Label>Token</Label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded border bg-muted px-3 py-2 font-mono text-xs">
                    {rawToken}
                  </code>
                  <Button variant="secondary" onClick={copyRawToken}>
                    <Copy className="mr-2 h-4 w-4" />
                    {copiedFlash ? "Copied" : "Copy"}
                  </Button>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={closeMintDialog}>I&rsquo;ve stored it safely</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Mint integration token</DialogTitle>
                <DialogDescription>
                  Give the token a human-readable name (usually the consumer
                  system) and grant only the scopes it needs.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="mint-name">Name</Label>
                  <Input
                    id="mint-name"
                    placeholder="vita-performance"
                    value={mintName}
                    onChange={(e) => setMintName(e.target.value)}
                    disabled={pending}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Scopes</Label>
                  <div className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
                    {knownScopes.map((s) => {
                      const checked = mintScopes.has(s);
                      return (
                        <label
                          key={s}
                          className="flex cursor-pointer items-center gap-2 text-sm"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => toggleScope(s)}
                            disabled={pending}
                          />
                          <span className="font-mono text-xs">{s}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
                {mintError && (
                  <p className="text-sm text-destructive">{mintError}</p>
                )}
              </div>
              <DialogFooter>
                <Button
                  variant="ghost"
                  onClick={() => setMintOpen(false)}
                  disabled={pending}
                >
                  Cancel
                </Button>
                <Button onClick={submitMint} disabled={pending}>
                  {pending ? "Minting…" : "Mint token"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Revoke confirmation */}
      <AlertDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this token?</AlertDialogTitle>
            <AlertDialogDescription>
              {revokeTarget && (
                <>
                  <strong>{revokeTarget.name}</strong> ({revokeTarget.prefix}…)
                  will stop authenticating immediately. Any consumer using
                  this token needs to be updated with a fresh one before it
                  can call PSP again.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="revoke-reason">Reason (optional)</Label>
            <Textarea
              id="revoke-reason"
              placeholder="e.g. rotated after quarterly review"
              value={revokeReason}
              onChange={(e) => setRevokeReason(e.target.value)}
              disabled={pending}
            />
            {revokeError && (
              <p className="text-sm text-destructive">{revokeError}</p>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={submitRevoke} disabled={pending}>
              {pending ? "Revoking…" : "Revoke"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
