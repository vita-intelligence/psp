import { redirect } from "next/navigation";
import Link from "next/link";
import { getDispatchAnyState } from "@/lib/three-pl/server";
import type { DispatchAnyState, DispatchStatus } from "@/lib/three-pl/types";

export const metadata = { title: "3PL scan · PSP" };
export const dynamic = "force-dynamic";

/**
 * Scan-to-open resolver. The printable 3PL label's QR encodes
 * ``/scan/three-pl/<dispatch_uuid>``. When any paired phone (or
 * signed-in desktop) scans that URL, this server component looks
 * up the dispatch's current lifecycle stage and redirects to the
 * appropriate screen — one physical sticker travels with the
 * parcel from Move → Paperwork → Pickup → Confirm → Return
 * without the label ever needing to know what stage the order is
 * on right now.
 *
 * Status → destination:
 *   pending         → /m/three-pl-dispatches/<uuid>  (Move walk-out)
 *   completed       → /m/shipments/<shipment>/paperwork | /dispatch
 *                     (whichever step the Shipment owes)
 *   return_pending  → /m/three-pl-returns/<uuid>     (walk-back)
 *   cancelled       → informational card (nothing to do)
 */
export default async function ScanThreePlDispatchPage({
  params,
}: {
  params: Promise<{ uuid: string }>;
}) {
  const { uuid } = await params;
  const dispatch = await getDispatchAnyState(uuid);

  if (!dispatch) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="text-lg font-semibold">Order not found</h1>
        <p className="text-sm text-muted-foreground">
          This label doesn&apos;t match any 3PL dispatch we know about. If
          it&apos;s a fresh order, refresh and try again — otherwise the
          record may have been cancelled or archived.
        </p>
        <Link
          href="/m/three-pl-dispatches"
          className="mt-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground"
        >
          Open 3PL hub
        </Link>
      </div>
    );
  }

  const target = await resolveTarget(dispatch);
  if (target) redirect(target);

  // Terminal / unclear state — show a friendly card instead of a
  // dead-end redirect loop.
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-lg font-semibold">Nothing to do here</h1>
      <p className="text-sm text-muted-foreground">
        This order is currently {humanStatus(dispatch.status)}. Nothing on
        the picker queue for now.
      </p>
      <Link
        href="/m/three-pl-dispatches"
        className="mt-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground"
      >
        Back to 3PL hub
      </Link>
    </div>
  );
}

async function resolveTarget(dispatch: DispatchAnyState): Promise<string | null> {
  switch (dispatch.status) {
    case "pending":
      // Picker owes the outbound walk-out.
      return `/m/three-pl-dispatches/${encodeURIComponent(dispatch.uuid)}`;

    case "return_pending":
      // Picker owes the walk-back.
      return `/m/three-pl-returns/${encodeURIComponent(dispatch.uuid)}`;

    case "completed": {
      // Goods are in the shipping bay — jump the picker to the
      // exact shipment page that owes the next action.
      const s = dispatch.shipment;
      if (!s) return "/m/three-pl-dispatches?tab=paperwork";
      switch (s.status) {
        case "draft":
          return `/m/shipments/${encodeURIComponent(s.uuid)}/paperwork`;
        case "ready":
        case "partially_picked":
          return `/m/shipments/${encodeURIComponent(s.uuid)}/dispatch`;
        case "picked_up":
        case "delivered":
          return "/m/three-pl-dispatches?tab=confirm";
        default:
          return "/m/three-pl-dispatches?tab=paperwork";
      }
    }

    default:
      return null;
  }
}

function humanStatus(status: DispatchStatus): string {
  switch (status) {
    case "cancelled":
      return "cancelled";
    case "completed":
      return "already picked up";
    case "pending":
      return "pending pickup";
    case "return_pending":
      return "waiting for a return walk";
  }
}
