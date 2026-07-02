"use server";

import { revalidatePath } from "next/cache";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import {
  syntheticErrorResult,
  toErrorResult,
  type ErrorResult,
} from "../errors/server";
import type { FinalRelease } from "./types";

export type FinalReleaseResult =
  | { ok: true; release: FinalRelease }
  | (ErrorResult & { ok: false });

async function token(): Promise<string | null> {
  return await getSessionToken();
}

function unauthorized(source: string): ErrorResult {
  return syntheticErrorResult({
    source,
    code: "unauthorized",
    detail: "Sign in to continue.",
  });
}

function revalidate(release: FinalRelease) {
  const lot = release.stock_lot?.uuid;
  if (lot) {
    revalidatePath(`/production/final-releases/${lot}`);
  }
  revalidatePath(`/production/final-releases/queue`);
}

export async function updateReleaseNotesAction(
  uuid: string,
  notes: string,
): Promise<FinalReleaseResult> {
  const t = await token();
  if (!t) return unauthorized("updateReleaseNotesAction");
  try {
    const { release } = await api<{ release: FinalRelease }>(
      `/api/production/final-releases/${encodeURIComponent(uuid)}/notes`,
      {
        method: "PATCH",
        token: t,
        body: JSON.stringify({ notes }),
      },
    );
    revalidate(release);
    return { ok: true, release };
  } catch (err) {
    return toErrorResult(err, {
      source: "updateReleaseNotesAction",
      fallbackDetail: "Couldn't save the notes.",
    });
  }
}

export async function signReleaserAction(
  uuid: string,
  signatureImage: string | null,
): Promise<FinalReleaseResult> {
  const t = await token();
  if (!t) return unauthorized("signReleaserAction");
  try {
    const { release } = await api<{ release: FinalRelease }>(
      `/api/production/final-releases/${encodeURIComponent(uuid)}/sign-releaser`,
      {
        method: "POST",
        token: t,
        body: JSON.stringify({ signature_image: signatureImage }),
      },
    );
    revalidate(release);
    return { ok: true, release };
  } catch (err) {
    return toErrorResult(err, {
      source: "signReleaserAction",
      fallbackDetail: "Couldn't record the releaser signature.",
    });
  }
}

export async function signApproverAction(
  uuid: string,
  signatureImage: string | null,
): Promise<FinalReleaseResult> {
  const t = await token();
  if (!t) return unauthorized("signApproverAction");
  try {
    const { release } = await api<{ release: FinalRelease }>(
      `/api/production/final-releases/${encodeURIComponent(uuid)}/sign-approver`,
      {
        method: "POST",
        token: t,
        body: JSON.stringify({ signature_image: signatureImage }),
      },
    );
    revalidate(release);
    return { ok: true, release };
  } catch (err) {
    return toErrorResult(err, {
      source: "signApproverAction",
      fallbackDetail: "Couldn't record the approver signature.",
    });
  }
}

export async function clearSignatureAction(
  uuid: string,
  role: "releaser" | "approver",
): Promise<FinalReleaseResult> {
  const t = await token();
  if (!t) return unauthorized("clearSignatureAction");
  try {
    const { release } = await api<{ release: FinalRelease }>(
      `/api/production/final-releases/${encodeURIComponent(uuid)}/clear-signature`,
      {
        method: "POST",
        token: t,
        body: JSON.stringify({ role }),
      },
    );
    revalidate(release);
    return { ok: true, release };
  } catch (err) {
    return toErrorResult(err, {
      source: "clearSignatureAction",
      fallbackDetail: "Couldn't clear the signature.",
    });
  }
}

export async function releaseAction(
  uuid: string,
  notes?: string,
): Promise<FinalReleaseResult> {
  const t = await token();
  if (!t) return unauthorized("releaseAction");
  try {
    const { release } = await api<{ release: FinalRelease }>(
      `/api/production/final-releases/${encodeURIComponent(uuid)}/release`,
      {
        method: "POST",
        token: t,
        body: JSON.stringify({ notes: notes ?? null }),
      },
    );
    revalidate(release);
    return { ok: true, release };
  } catch (err) {
    return toErrorResult(err, {
      source: "releaseAction",
      fallbackDetail: "Couldn't finalise the release.",
    });
  }
}

export async function holdAction(
  uuid: string,
  reason: string,
): Promise<FinalReleaseResult> {
  const t = await token();
  if (!t) return unauthorized("holdAction");
  try {
    const { release } = await api<{ release: FinalRelease }>(
      `/api/production/final-releases/${encodeURIComponent(uuid)}/hold`,
      {
        method: "POST",
        token: t,
        body: JSON.stringify({ hold_reason: reason }),
      },
    );
    revalidate(release);
    return { ok: true, release };
  } catch (err) {
    return toErrorResult(err, {
      source: "holdAction",
      fallbackDetail: "Couldn't place on hold.",
    });
  }
}

export async function rejectAction(
  uuid: string,
  reason: string,
): Promise<FinalReleaseResult> {
  const t = await token();
  if (!t) return unauthorized("rejectAction");
  try {
    const { release } = await api<{ release: FinalRelease }>(
      `/api/production/final-releases/${encodeURIComponent(uuid)}/reject`,
      {
        method: "POST",
        token: t,
        body: JSON.stringify({ reject_reason: reason }),
      },
    );
    revalidate(release);
    return { ok: true, release };
  } catch (err) {
    return toErrorResult(err, {
      source: "rejectAction",
      fallbackDetail: "Couldn't reject the batch.",
    });
  }
}
