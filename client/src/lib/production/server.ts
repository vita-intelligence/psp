import "server-only";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type {
  BOM,
  BOMLedgerPage,
  ManufacturingOrder,
  ManufacturingOrderLedgerPage,
  ManufacturingOrderStep,
  Routing,
  RoutingLedgerPage,
  Workstation,
  WorkstationGroup,
  WorkstationGroupLedgerPage,
  WorkstationLedgerPage,
} from "./types";

export interface ListBOMsOpts {
  /** Append to the upstream query string verbatim — e.g.
   *  `"item_id=42&limit=25"`. */
  query?: string;
}

export async function listBOMsPage(
  opts: ListBOMsOpts = {},
): Promise<BOMLedgerPage | null> {
  const token = await getSessionToken();
  if (!token) return null;
  const qs = opts.query ? `?${opts.query}` : "";
  try {
    return await api<BOMLedgerPage>(`/api/production/boms${qs}`, {
      token,
      cache: "no-store",
    });
  } catch {
    return null;
  }
}

export async function getBOM(uuid: string): Promise<BOM | null> {
  const token = await getSessionToken();
  if (!token) return null;
  try {
    const { bom } = await api<{ bom: BOM }>(
      `/api/production/boms/${encodeURIComponent(uuid)}`,
      { token, cache: "no-store" },
    );
    return bom;
  } catch {
    return null;
  }
}

/**
 * Fetch every BOM attached to one output item. Used by the Item
 * detail page's BOMs card. Sorts the primary first.
 */
export async function listBOMsForItem(
  itemId: number,
): Promise<BOMLedgerPage["items"]> {
  const token = await getSessionToken();
  if (!token) return [];
  try {
    const page = await api<BOMLedgerPage>(
      `/api/production/boms?item_id=${encodeURIComponent(String(itemId))}&limit=50&sort=is_primary:desc`,
      { token, cache: "no-store" },
    );
    // Backend default sort still applies after; the FE sorts again
    // to make absolutely sure the primary lands first.
    return page.items.slice().sort((a, b) => {
      if (a.is_primary === b.is_primary) return 0;
      return a.is_primary ? -1 : 1;
    });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------
// Workstation groups
// ---------------------------------------------------------------

export interface ListWorkstationGroupsOpts {
  query?: string;
}

export async function listWorkstationGroupsPage(
  opts: ListWorkstationGroupsOpts = {},
): Promise<WorkstationGroupLedgerPage | null> {
  const token = await getSessionToken();
  if (!token) return null;
  const qs = opts.query ? `?${opts.query}` : "";
  try {
    return await api<WorkstationGroupLedgerPage>(
      `/api/production/workstation-groups${qs}`,
      { token, cache: "no-store" },
    );
  } catch {
    return null;
  }
}

export async function getWorkstationGroup(
  uuid: string,
): Promise<WorkstationGroup | null> {
  const token = await getSessionToken();
  if (!token) return null;
  try {
    const { group } = await api<{ group: WorkstationGroup }>(
      `/api/production/workstation-groups/${encodeURIComponent(uuid)}`,
      { token, cache: "no-store" },
    );
    return group;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------
// Workstations
// ---------------------------------------------------------------

export interface ListWorkstationsOpts {
  query?: string;
}

export async function listWorkstationsPage(
  opts: ListWorkstationsOpts = {},
): Promise<WorkstationLedgerPage | null> {
  const token = await getSessionToken();
  if (!token) return null;
  const qs = opts.query ? `?${opts.query}` : "";
  try {
    return await api<WorkstationLedgerPage>(
      `/api/production/workstations${qs}`,
      { token, cache: "no-store" },
    );
  } catch {
    return null;
  }
}

export async function getWorkstation(
  uuid: string,
): Promise<Workstation | null> {
  const token = await getSessionToken();
  if (!token) return null;
  try {
    const { workstation } = await api<{ workstation: Workstation }>(
      `/api/production/workstations/${encodeURIComponent(uuid)}`,
      { token, cache: "no-store" },
    );
    return workstation;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------
// Routings
// ---------------------------------------------------------------

export interface ListRoutingsOpts {
  query?: string;
}

export async function listRoutingsPage(
  opts: ListRoutingsOpts = {},
): Promise<RoutingLedgerPage | null> {
  const token = await getSessionToken();
  if (!token) return null;
  const qs = opts.query ? `?${opts.query}` : "";
  try {
    return await api<RoutingLedgerPage>(`/api/production/routings${qs}`, {
      token,
      cache: "no-store",
    });
  } catch {
    return null;
  }
}

export async function getRouting(uuid: string): Promise<Routing | null> {
  const token = await getSessionToken();
  if (!token) return null;
  try {
    const { routing } = await api<{ routing: Routing }>(
      `/api/production/routings/${encodeURIComponent(uuid)}`,
      { token, cache: "no-store" },
    );
    return routing;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------
// Manufacturing orders
// ---------------------------------------------------------------

export interface ListManufacturingOrdersOpts {
  query?: string;
}

export async function listManufacturingOrdersPage(
  opts: ListManufacturingOrdersOpts = {},
): Promise<ManufacturingOrderLedgerPage | null> {
  const token = await getSessionToken();
  if (!token) return null;
  const qs = opts.query ? `?${opts.query}` : "";
  try {
    return await api<ManufacturingOrderLedgerPage>(
      `/api/production/manufacturing-orders${qs}`,
      { token, cache: "no-store" },
    );
  } catch {
    return null;
  }
}

export async function getManufacturingOrder(
  uuid: string,
): Promise<ManufacturingOrder | null> {
  const token = await getSessionToken();
  if (!token) return null;
  try {
    const { mo } = await api<{ mo: ManufacturingOrder }>(
      `/api/production/manufacturing-orders/${encodeURIComponent(uuid)}`,
      { token, cache: "no-store" },
    );
    return mo;
  } catch {
    return null;
  }
}

export async function getManufacturingOrderStep(
  moUuid: string,
  stepUuid: string,
): Promise<ManufacturingOrderStep | null> {
  const token = await getSessionToken();
  if (!token) return null;
  try {
    const { step } = await api<{ step: ManufacturingOrderStep }>(
      `/api/production/manufacturing-orders/${encodeURIComponent(moUuid)}/steps/${encodeURIComponent(stepUuid)}`,
      { token, cache: "no-store" },
    );
    return step;
  } catch {
    return null;
  }
}
