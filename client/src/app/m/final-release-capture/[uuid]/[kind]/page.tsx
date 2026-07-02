import { redirect } from "next/navigation";
import { getDeviceToken } from "@/lib/devices/server";
import { getSessionToken } from "@/lib/auth/server";
import { FINAL_RELEASE_FILE_KINDS } from "@/lib/production-final-release/types";
import type { FinalReleaseFileKind } from "@/lib/production-final-release/types";
import { CaptureShell } from "./capture-shell";

export const metadata = { title: "Take photo · Final release · PSP Mobile" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ uuid: string; kind: string }>;
}

export default async function MobileFinalReleaseCapturePage({ params }: Props) {
  const [{ uuid, kind }, deviceToken, sessionToken] = await Promise.all([
    params,
    getDeviceToken(),
    getSessionToken(),
  ]);
  if (!deviceToken && !sessionToken) redirect("/pair");

  const validKind = (FINAL_RELEASE_FILE_KINDS as string[]).includes(kind);
  if (!validKind) redirect("/m");

  return (
    <CaptureShell
      releaseUuid={uuid}
      kind={kind as FinalReleaseFileKind}
    />
  );
}
