import "server-only";
import { api } from "../api";
import { getSessionToken } from "../auth/server";

export interface OverdueRow {
  uuid: string;
  name: string;
  due_at: string | null;
  last_at: string | null;
}

export interface OverdueBucket {
  count: number;
  kind: "cleaning" | "maintenance";
  preview: OverdueRow[];
}

export interface ComplianceOverview {
  as_of: string;
  buckets: {
    workstation_cleaning: OverdueBucket;
    workstation_maintenance: OverdueBucket;
    equipment_cleaning: OverdueBucket;
    equipment_maintenance: OverdueBucket;
  };
}

/** Fetch the compliance overview (overdue cleaning + maintenance
 *  across every workstation + equipment in the tenant). Returns
 *  `null` on transport failure so the RSC can render the widget's
 *  soft-fail shell instead of crashing the dashboard. */
export async function getComplianceOverview(): Promise<ComplianceOverview | null> {
  const token = await getSessionToken();
  if (!token) return null;
  try {
    return await api<ComplianceOverview>(
      "/api/production/compliance-overview",
      { token, cache: "no-store" },
    );
  } catch {
    return null;
  }
}
