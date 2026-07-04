// Shared "warehouse + production site" filter defs. Any list page whose
// backing entity has a `warehouse_id` or `production_site_id` FK can
// call `buildLocationFilters()` server-side and append the returned
// `FilterDef[]` to its `<DataTable filters={…}>`.
//
// This keeps the two filters visually consistent across the app and
// avoids each page fetching its own warehouse list.
//
// Use pattern (server component):
//
//     const locationFilters = await buildLocationFilters();
//     …
//     <SomeTable filters={[...existingFilters, ...locationFilters]} />

import type { FilterDef } from "@/components/data-table";
import {
  listWarehousesFirstPage,
  listProductionFacilitiesFirstPage,
} from "@/lib/warehouses/server";

interface Options {
  /** Include the warehouse dropdown. Default true. */
  warehouse?: boolean;
  /** Include the production-site dropdown. Default true. */
  productionSite?: boolean;
  /** Backend field name for the warehouse FK. Default `"warehouse_id"`. */
  warehouseField?: string;
  /** Backend field name for the production-site FK. Default
   *  `"production_site_id"`. */
  productionSiteField?: string;
}

export async function buildLocationFilters({
  warehouse = true,
  productionSite = true,
  warehouseField = "warehouse_id",
  productionSiteField = "production_site_id",
}: Options = {}): Promise<FilterDef[]> {
  const out: FilterDef[] = [];

  if (warehouse) {
    // Pull the first 100 warehouses — the dropdown chokes past that.
    // Sites with more than 100 warehouses can extend this by paging.
    const page = await listWarehousesFirstPage(100);
    if (page.items.length > 0) {
      out.push({
        field: warehouseField,
        label: "Warehouse",
        options: page.items.map((w) => ({
          label: w.name,
          value: w.id,
        })),
      });
    }
  }

  if (productionSite) {
    const page = await listProductionFacilitiesFirstPage(100);
    if (page.items.length > 0) {
      out.push({
        field: productionSiteField,
        label: "Production site",
        options: page.items.map((s) => ({
          label: s.name,
          value: s.id,
        })),
      });
    }
  }

  return out;
}
