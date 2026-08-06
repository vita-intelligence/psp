"use client";

import { FlaskConical } from "lucide-react";
import { NpdSheetEmbed } from "./npd-sheet-embed";

interface Props {
  /**
   * PSP proxy URL for the NPD validation sheet. Two shapes today:
   *   * `/api/production/output-qc/:lot_uuid/npd-validation.html`
   *   * `/api/production/manufacturing-orders/:uuid/npd-validation.html`
   */
  src: string;
}

/** Thin wrapper — validation sheets are just a labelled sheet embed. */
export function NpdValidationEmbed({ src }: Props) {
  return (
    <NpdSheetEmbed
      title="Product validation sheet"
      src={src}
      loadingLabel="Loading validation sheet…"
      icon={
        <FlaskConical className="size-4 text-indigo-600 dark:text-indigo-400" />
      }
    />
  );
}
