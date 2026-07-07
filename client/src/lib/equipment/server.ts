import "server-only";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type {
  Equipment,
  EquipmentDueRow,
  EquipmentEvent,
  EquipmentFile,
} from "./types";

/** First-page fetch for the ledger. Cursor + sort + filter continue
 *  via the client-side DataTable. Returns null on any failure so
 *  the RSC can fall through to a graceful empty state. */
export async function listEquipmentPage(): Promise<{
  items: Equipment[];
  next_cursor: string | null;
} | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    return await api<{ items: Equipment[]; next_cursor: string | null }>(
      "/api/equipment?limit=25",
      { token, cache: "no-store" },
    );
  } catch {
    return null;
  }
}

export async function getEquipment(uuid: string): Promise<Equipment | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    const { equipment } = await api<{ equipment: Equipment }>(
      `/api/equipment/${encodeURIComponent(uuid)}`,
      { token, cache: "no-store" },
    );
    return equipment;
  } catch {
    return null;
  }
}

export async function listEquipmentDueSoon(horizonDays = 14): Promise<{
  horizon_days: number;
  total: number;
  rows: EquipmentDueRow[];
} | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    return await api<{
      horizon_days: number;
      total: number;
      rows: EquipmentDueRow[];
    }>(`/api/equipment/due-soon?horizon_days=${horizonDays}`, {
      token,
      cache: "no-store",
    });
  } catch {
    return null;
  }
}

export async function listEquipmentEvents(
  uuid: string,
): Promise<EquipmentEvent[]> {
  const token = await getSessionToken();
  if (!token) return [];

  try {
    const { events } = await api<{ events: EquipmentEvent[] }>(
      `/api/equipment/${encodeURIComponent(uuid)}/events`,
      { token, cache: "no-store" },
    );
    return events;
  } catch {
    return [];
  }
}

export async function listEquipmentFiles(
  uuid: string,
): Promise<EquipmentFile[]> {
  const token = await getSessionToken();
  if (!token) return [];

  try {
    const { files } = await api<{ files: EquipmentFile[] }>(
      `/api/equipment/${encodeURIComponent(uuid)}/files`,
      { token, cache: "no-store" },
    );
    return files;
  } catch {
    return [];
  }
}
