"use client";

import { FileText, Info } from "lucide-react";
import type { OutputQcEntry } from "@/lib/production/types";
import { NpdSheetEmbed } from "@/components/production/npd-sheet-embed";

interface Props {
  entry: OutputQcEntry;
}

/**
 * NPD spec sheet on the Output QC page. Collapsible via the shared
 * embed so QA can toggle it without the iframe permanently sitting
 * in the layout — mirrors the MO detail treatment.
 *
 * The iframe points at PSP's own
 * `/api/production/output-qc/:lot_uuid/npd-spec.html`. PSP's
 * controller server-side-fetches NPD's rendered HTML using the
 * shared integration bearer, then streams it back under PSP's own
 * session — no public link, no leaked NPD URL, no token in the DOM.
 *
 * When the lot is a semi-finished intermediate the source resolves
 * to the parent product; a small banner flags that so QA knows the
 * sheet below is the finished product this lot feeds into.
 */
export function SpecSheet({ entry }: Props) {
  const source = entry.finished_product_spec_source;
  const ownItemName =
    entry.lot.item?.name ?? entry.mo?.item?.name ?? "This item";
  const parentItemName = source.kind === "parent" ? source.item_name : null;

  const src = `/api/production/output-qc/${encodeURIComponent(
    entry.lot.uuid,
  )}/npd-spec.html`;

  return (
    <div className="space-y-3">
      {source.kind === "parent" && (
        <div className="flex items-start gap-2 rounded-lg border border-sky-500/30 bg-sky-500/5 p-3 text-xs">
          <Info className="mt-0.5 size-4 shrink-0 text-sky-600 dark:text-sky-400" />
          <div className="space-y-0.5">
            <p className="font-medium">
              Parent product spec inherited from{" "}
              <span className="font-mono">
                {parentItemName ?? "parent MO"}
              </span>
            </p>
            <p className="text-muted-foreground">
              <span className="font-medium">{ownItemName}</span> is a
              semi-finished intermediate. The sheet below is the finished
              product it feeds into — use it as the reference target for
              this lot.
            </p>
          </div>
        </div>
      )}

      <NpdSheetEmbed
        title="Product specification sheet"
        src={src}
        loadingLabel="Loading NPD spec sheet…"
        icon={<FileText className="size-4 text-muted-foreground" />}
      />
    </div>
  );
}
