"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, GitMerge } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatCompanyNumber } from "@/lib/format/company";
import { mergeMOIntoBatchAction } from "@/lib/production/actions";
import { invalidateAudit } from "@/lib/audit/invalidator";
import type { CompanyDefaults } from "@/lib/types";
import type {
  ManufacturingOrder,
  ManufacturingOrderMergeCandidate,
} from "@/lib/production/types";

interface Props {
  /** The source sub-MO that's being merged INTO a target batch. */
  source: ManufacturingOrder;
  company: CompanyDefaults;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Merges this sub-MO into another open sub-MO producing the same
 * item. The target absorbs the qty; this MO is cancelled; a
 * consumer link records that the target batch also feeds THIS MO's
 * parent. The end state: one shared blend run that supplies two
 * different downstream MOs.
 */
export function MergeIntoBatchDialog({
  source,
  company,
  open,
  onOpenChange,
}: Props) {
  const router = useRouter();
  const [candidates, setCandidates] = useState<ManufacturingOrderMergeCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [pickedUuid, setPickedUuid] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const itemName = source.item?.name ?? "this item";
  const uom = source.item?.stock_uom?.symbol ?? "";

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    fetch(
      `/api/production/manufacturing-orders/${encodeURIComponent(source.uuid)}/merge-candidates`,
      { cache: "no-store" },
    )
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((body: { items?: ManufacturingOrderMergeCandidate[] }) => {
        if (!alive) return;
        setCandidates(body.items ?? []);
      })
      .catch(() => alive && setCandidates([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [open, source.uuid]);

  const picked = candidates.find((c) => c.uuid === pickedUuid) ?? null;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!picked) {
      setError("Pick a batch to merge into.");
      return;
    }
    setError(null);

    startTransition(async () => {
      const res = await mergeMOIntoBatchAction(source.uuid, picked.uuid);
      if (res.ok) {
        toast.success(
          `Merged into ${picked.code ?? "batch"} — this MO cancelled, batch qty bumped.`,
        );
        invalidateAudit("manufacturing_order", source.id);
        onOpenChange(false);
        router.refresh();
      } else {
        setError(res.detail);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Merge into another batch</DialogTitle>
          <DialogDescription>
            Combine this {formatCompanyNumber(source.quantity, company)} {uom}{" "}
            run for{" "}
            <span className="font-medium text-foreground">{itemName}</span>{" "}
            into an open batch producing the same item. This MO will be
            cancelled and the target batch&apos;s qty will be bumped by the
            difference. Useful when two projects need the same powder
            blended at the same time.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" />
              Loading candidates…
            </div>
          ) : candidates.length === 0 ? (
            <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-6 text-center text-xs text-muted-foreground">
              No other open sub-MOs producing {itemName}. Nothing to merge into
              right now.
            </div>
          ) : (
            <div className="max-h-72 overflow-y-auto rounded-md border border-border/60">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="w-6 px-2 py-1.5" />
                    <th className="px-2 py-1.5 text-left">Batch MO</th>
                    <th className="px-2 py-1.5 text-left">Status</th>
                    <th className="px-2 py-1.5 text-right">Current qty</th>
                    <th className="px-2 py-1.5 text-left">Feeds</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {candidates.map((c) => {
                    const selected = pickedUuid === c.uuid;
                    return (
                      <tr
                        key={c.uuid}
                        onClick={() => setPickedUuid(c.uuid)}
                        className={cn(
                          "cursor-pointer",
                          selected ? "bg-brand/10" : "hover:bg-muted/40",
                        )}
                      >
                        <td className="px-2 py-1.5">
                          <input
                            type="radio"
                            checked={selected}
                            onChange={() => setPickedUuid(c.uuid)}
                            className="size-3.5"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <p className="font-mono text-[10px] font-semibold">
                            {c.code ?? `MO #${c.id}`}
                          </p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {c.item.name}
                          </p>
                        </td>
                        <td className="px-2 py-1.5 capitalize">
                          {c.status.replace("_", " ")}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono">
                          {formatCompanyNumber(c.quantity, company)} {uom}
                        </td>
                        <td className="px-2 py-1.5 font-mono text-[10px] text-muted-foreground">
                          {c.parent_mo?.code ?? "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {picked && (
            <div className="rounded-md border border-brand/30 bg-brand/5 px-3 py-2 text-[11px]">
              <p className="flex items-start gap-2">
                <GitMerge className="mt-0.5 size-3.5 shrink-0 text-brand" />
                <span>
                  After merge:{" "}
                  <span className="font-mono">
                    {picked.code ?? `MO #${picked.id}`}
                  </span>{" "}
                  bumps from{" "}
                  <span className="font-mono">
                    {formatCompanyNumber(picked.quantity, company)} {uom}
                  </span>{" "}
                  →{" "}
                  <span className="font-mono font-semibold">
                    {formatCompanyNumber(
                      String(Number(picked.quantity) + Number(source.quantity)),
                      company,
                    )}{" "}
                    {uom}
                  </span>
                  . This MO ({source.code ?? `#${source.id}`}) cancels and the
                  batch will also feed your project.
                </span>
              </p>
            </div>
          )}

          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/[0.04] px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!picked || pending}>
              {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Merge
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
