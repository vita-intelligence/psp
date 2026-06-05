import "server-only";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { CertExpiringQueueRow, ReviewDueQueueRow } from "../types";

const DEFAULT_WINDOW = 30;

export async function listReviewsDue(
  windowDays: number = DEFAULT_WINDOW,
): Promise<{ items: ReviewDueQueueRow[]; window_days: number } | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    return await api<{
      items: ReviewDueQueueRow[];
      window_days: number;
    }>(`/api/queues/reviews-due?window_days=${windowDays}`, {
      token,
      cache: "no-store",
    });
  } catch {
    return null;
  }
}

export async function listCertificatesExpiring(
  windowDays: number = DEFAULT_WINDOW,
): Promise<{ items: CertExpiringQueueRow[]; window_days: number } | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    return await api<{
      items: CertExpiringQueueRow[];
      window_days: number;
    }>(`/api/queues/certificates-expiring?window_days=${windowDays}`, {
      token,
      cache: "no-store",
    });
  } catch {
    return null;
  }
}
