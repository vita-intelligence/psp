"use client";

import { useRouter } from "next/navigation";
import type { OutputQcEntry } from "@/lib/production/types";
import type { FormatPrefs } from "@/lib/format/company";
import { QcCard } from "../output-qc-workspace";

interface Props {
  entry: OutputQcEntry;
  companyDateFormat: FormatPrefs | null;
}

/**
 * Detail-page host for the existing QcCard flow (pass, adjust-and-pass,
 * fail-full, fail-partial). On successful sign-off we route back to
 * the list so the operator can pick up the next lot without a stale
 * detail page hanging around.
 */
export function QcActionsCard({ entry, companyDateFormat }: Props) {
  const router = useRouter();
  return (
    <QcCard
      entry={entry}
      companyDateFormat={companyDateFormat}
      onSignedOff={() => router.push("/production/output-qc")}
    />
  );
}
