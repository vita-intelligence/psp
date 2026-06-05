import "server-only";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { Certificate } from "../types";

export async function listCertificatesPage(): Promise<{
  items: Certificate[];
  next_cursor: string | null;
} | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    return await api<{ items: Certificate[]; next_cursor: string | null }>(
      "/api/certificates",
      { token, cache: "no-store" },
    );
  } catch {
    return null;
  }
}

export async function listCertificatesForPicker(): Promise<Certificate[] | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    const res = await api<{ items: Certificate[] }>(
      "/api/certificates?picker=true",
      { token, cache: "no-store" },
    );
    return res.items;
  } catch {
    return null;
  }
}

export async function getCertificate(uuid: string): Promise<Certificate | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    const { certificate } = await api<{ certificate: Certificate }>(
      `/api/certificates/${uuid}`,
      { token, cache: "no-store" },
    );
    return certificate;
  } catch {
    return null;
  }
}
