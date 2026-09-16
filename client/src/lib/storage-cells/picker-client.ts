import type { SearchPickerOption } from "@/components/forms/search-picker";

export interface StorageCellPickerOption extends SearchPickerOption {
  uuid: string;
  purpose: string | null;
  locationUuid: string;
  locationName: string;
  floorUuid: string;
  floorName: string;
  warehouseUuid: string;
  warehouseName: string;
}

/**
 * Build a `SearchPicker` fetcher for the tenant-wide storage-cell
 * picker feed. Same shape as `itemPickerFetcher` — call it once,
 * memoise the returned fetcher, hand it to `<SearchPicker />`.
 *
 * The backend endpoint is deliberately flat (not nested under a
 * warehouse) so the operator can pick any cell across the tenant
 * without a two-step warehouse → cell selector.
 */
export function storageCellPickerFetcher(opts?: { limit?: number }) {
  const limit = opts?.limit ?? 25;

  return async (
    query: string,
    signal?: AbortSignal,
  ): Promise<StorageCellPickerOption[]> => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (query.trim()) params.set("search", query.trim());

    const res = await fetch(`/api/storage-cells/picker?${params.toString()}`, {
      cache: "no-store",
      signal,
    });
    if (!res.ok) {
      throw new Error(`Cell search failed (${res.status})`);
    }
    const body = (await res.json()) as {
      items: Array<{
        uuid: string;
        name: string;
        purpose: string | null;
        location_uuid: string;
        location_name: string;
        floor_uuid: string;
        floor_name: string;
        warehouse_uuid: string;
        warehouse_name: string;
      }>;
    };
    // SearchPicker wants an `id: number` — cells key on uuid, so
    // hash the uuid into a stable integer for the option row's
    // React key. The `onChange` handler reads `uuid` off the option.
    return body.items.map<StorageCellPickerOption>((c) => ({
      id: hashCode(c.uuid),
      label: c.name,
      code: c.warehouse_name,
      sublabel: c.location_name,
      uuid: c.uuid,
      purpose: c.purpose,
      locationUuid: c.location_uuid,
      locationName: c.location_name,
      floorUuid: c.floor_uuid,
      floorName: c.floor_name,
      warehouseUuid: c.warehouse_uuid,
      warehouseName: c.warehouse_name,
    }));
  };
}

// Deterministic string→int32 hash for React keys. Not cryptographic;
// only used to satisfy SearchPicker's numeric-id contract.
function hashCode(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}
