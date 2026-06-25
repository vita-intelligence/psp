import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { listCommentsForEntity } from "@/lib/comments/server";
import { getCustomerOrder } from "@/lib/customer-orders/server";
import { getOrderWizard } from "@/lib/order-wizard/server";
import { getCompanyDefaults } from "@/lib/company/server";
import { ProjectControlBoard } from "./project-control-board";

export const metadata = { title: "Project Control Board · PSP" };

/**
 * Standalone Project Control Board — every lever for a customer
 * order's lifecycle in one page. Replaces the wizard tab on the CO
 * detail page; the goal is that an operator clicks the project card
 * once and never has to leave this URL except for the scheduler grid
 * and mobile flows (which open via QR codes).
 *
 * Server-side fetches:
 *
 *   - `getCustomerOrder` (header + customer card)
 *   - `getOrderWizard` (phase / next action / blockers / lines / MOs
 *     / open POs / timeline / signers)
 *   - `getCompanyDefaults` (date / money formatting)
 *   - `listCommentsForEntity("customer_order", ...)` (right-column
 *     thread, hands off to the realtime `<CommentThread>`)
 *
 * The board component then takes over on the client — realtime
 * channel subscription, action plumbing, modal orchestration.
 */
export default async function ProjectBoardPage({
  params,
}: {
  params: Promise<{ uuid: string }>;
}) {
  const user = await requireUser();
  if (!hasPermission(user, "customer_orders.view")) {
    redirect("/settings/profile");
  }

  const { uuid } = await params;

  const [co, wizard, company, initialComments] = await Promise.all([
    getCustomerOrder(uuid),
    getOrderWizard(uuid),
    getCompanyDefaults(),
    listCommentsForEntity("customer_order", uuid),
  ]);

  if (!co || !company) notFound();

  // Permission flags surfaced to the client board so it can disable
  // CTAs the user can't perform. Backend still enforces these — these
  // are UX hints, not the gate.
  const canEdit = hasPermission(user, "customer_orders.create");
  const canSubmit = hasPermission(user, "customer_orders.submit");
  const canApprove = hasPermission(user, "customer_orders.approve");
  const canDirectorApprove = hasPermission(
    user,
    "customer_orders.director_approve",
  );
  // Confirm-to-production is the same writer who can submit; we
  // collapse it onto canSubmit so the gate stays one perm.
  const canConfirm = canSubmit;
  const canManageMOs = hasPermission(user, "production.mo_create");

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />

      <ProjectControlBoard
        co={co}
        wizard={wizard}
        prefs={company}
        initialComments={initialComments ?? []}
        currentUserId={user.id}
        permissions={{
          canEdit,
          canSubmit,
          canApprove,
          canDirectorApprove,
          canConfirm,
          canManageMOs,
        }}
      />
    </div>
  );
}
