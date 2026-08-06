"use client";

import { FileText } from "lucide-react";
import { NpdSheetEmbed } from "@/components/production/npd-sheet-embed";

interface Props {
  moUuid: string;
}

/** MO detail spec sheet — thin wrapper over the shared sheet embed. */
export function MOSpecSheet({ moUuid }: Props) {
  return (
    <NpdSheetEmbed
      title="Product specification sheet"
      src={`/api/production/manufacturing-orders/${encodeURIComponent(moUuid)}/npd-spec.html`}
      loadingLabel="Loading NPD spec sheet…"
      icon={<FileText className="size-4 text-muted-foreground" />}
    />
  );
}
