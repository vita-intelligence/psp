import { getCurrentUser } from "@/lib/auth/server";
import { PresenceMountClient } from "./presence-mount-client";

/**
 * Server wrapper — resolves the current user's company_id so the
 * client-side hook can join the per-tenant lobby topic
 * (`lobby:<company_id>`). Splitting server/client this way lets the
 * ~70 layouts that already render `<PresenceMount />` keep working
 * unchanged.
 *
 * Renders nothing visible.
 */
export async function PresenceMount() {
  const user = await getCurrentUser();
  if (!user?.company_id) return null;

  return <PresenceMountClient companyId={user.company_id} />;
}
