import "server-only";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { UnitOfMeasurement, UnitDimension } from "../types";

/** Picker variant — every unit (or just those in `dimension`). Used by
 *  server components that need the registry on first render. */
export async function listUnitsOfMeasurement(
  dimension?: UnitDimension,
): Promise<UnitOfMeasurement[] | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    const qs = dimension ? `?dimension=${dimension}` : "";
    const res = await api<{ items: UnitOfMeasurement[] }>(
      `/api/units-of-measurement${qs}`,
      { token, cache: "no-store" },
    );
    return res.items;
  } catch {
    return null;
  }
}

/** Cursor-paginated server fetch — feeds the admin DataTable's SSR. */
export async function listUnitsOfMeasurementPage(): Promise<{
  items: UnitOfMeasurement[];
  next_cursor: string | null;
} | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    return await api<{
      items: UnitOfMeasurement[];
      next_cursor: string | null;
    }>("/api/units-of-measurement", { token, cache: "no-store" });
  } catch {
    return null;
  }
}

/** Single-unit fetch for the edit page. */
export async function getUnitOfMeasurement(
  uuid: string,
): Promise<UnitOfMeasurement | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    const { unit } = await api<{ unit: UnitOfMeasurement }>(
      `/api/units-of-measurement/${uuid}`,
      { token, cache: "no-store" },
    );
    return unit;
  } catch {
    return null;
  }
}
