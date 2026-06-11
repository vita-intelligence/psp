import fs from "node:fs";
import type { APIRequestContext } from "@playwright/test";

/**
 * Shared fixtures helper for the end-to-end form suite. Most form tests
 * need at least one existing entity (a warehouse, an active item, an
 * approved vendor) to satisfy their picker dropdowns. We grab the first
 * one the dev DB returns; if there isn't one, we create one via the API
 * using the seeded admin session.
 *
 * This keeps the tests independent of dev-DB state — a fresh DB still
 * runs the same suite.
 */

const BACKEND_URL = process.env.E2E_BACKEND_URL || "http://localhost:4000";

function bearer(): string {
  const state = JSON.parse(fs.readFileSync(".auth/laptop.json", "utf-8")) as {
    cookies: Array<{ name: string; value: string }>;
  };
  return state.cookies.find((c) => c.name === "psp_session")?.value ?? "";
}

export async function apiCtx(
  playwright: { request: { newContext: (...args: unknown[]) => Promise<APIRequestContext> } },
): Promise<APIRequestContext> {
  return await playwright.request.newContext({
    baseURL: BACKEND_URL,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { Authorization: `Bearer ${bearer()}` },
  });
}

export async function getOrCreateWarehouse(
  api: APIRequestContext,
): Promise<{ id: number; uuid: string; name: string }> {
  const list = await api.get("/api/warehouses?limit=1");
  const data = (await list.json()) as {
    items?: Array<{ id: number; uuid: string; name: string }>;
  };
  if (data.items && data.items[0]) return data.items[0];

  const created = await api.post("/api/warehouses", {
    data: { name: `E2E warehouse ${Date.now()}` },
  });
  const body = (await created.json()) as {
    warehouse: { id: number; uuid: string; name: string };
  };
  return body.warehouse;
}

export async function getOrCreateActiveItem(
  api: APIRequestContext,
): Promise<{ id: number; uuid: string; name: string; code: string }> {
  const list = await api.get("/api/items?limit=1");
  const data = (await list.json()) as {
    items?: Array<{
      id: number;
      uuid: string;
      name: string;
      code: string;
      is_active: boolean;
    }>;
  };
  const active = data.items?.find((i) => i.is_active);
  if (active) return active;

  // Find a stock UoM to attach.
  const uoms = await api.get("/api/units-of-measurement?limit=1");
  const uomData = (await uoms.json()) as { items?: Array<{ id: number }> };
  const uomId = uomData.items?.[0]?.id;

  const created = await api.post("/api/items", {
    data: {
      name: `E2E item ${Date.now()}`,
      item_type: "raw_material",
      stock_uom_id: uomId ?? null,
      is_active: true,
    },
  });
  const body = (await created.json()) as {
    item: { id: number; uuid: string; name: string; code: string };
  };
  return body.item;
}

export async function getOrCreateApprovedVendor(
  api: APIRequestContext,
): Promise<{ id: number; uuid: string; name: string; code: string | null }> {
  const list = await api.get(
    "/api/vendors?limit=10&approval_status=approved&is_active=true",
  );
  const data = (await list.json()) as {
    items?: Array<{
      id: number;
      uuid: string;
      name: string;
      code: string | null;
      approval_status: string;
      is_active: boolean;
    }>;
  };
  const ok = data.items?.find(
    (v) => v.approval_status === "approved" && v.is_active,
  );
  if (ok) return ok;

  // Create then approve manually via API.
  const created = await api.post("/api/vendors", {
    data: {
      name: `E2E vendor ${Date.now()}`,
      currency_code: "GBP",
      default_lead_time_days: 7,
      payment_terms_days: 30,
      payment_basis: "invoice_date",
      vendor_risk: "low",
    },
  });
  const body = (await created.json()) as {
    vendor: { id: number; uuid: string; name: string; code: string | null };
  };
  // Skip approval flow here — caller can fall back to picking by id even
  // if not approved. PO flow tests will need an approved one and will
  // call approve_vendor separately.
  return body.vendor;
}

export async function getFirstStockLotUuid(
  api: APIRequestContext,
): Promise<string | null> {
  const res = await api.get("/api/stock/lots?limit=1");
  const json = (await res.json()) as {
    items?: Array<{ uuid: string }>;
  };
  return json.items?.[0]?.uuid ?? null;
}
