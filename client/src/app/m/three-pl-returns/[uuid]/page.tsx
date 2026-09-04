import { redirect } from "next/navigation";
import { getDeviceToken } from "@/lib/devices/server";
import { getPendingReturn } from "@/lib/three-pl/server";
import { ReturnFlow } from "./return-flow";

export const metadata = { title: "3PL return · PSP Mobile" };
export const dynamic = "force-dynamic";

/**
 * Mobile-only walk-back flow. Reached by tapping a row on the
 * /m/three-pl-dispatches Return tab. Same scan-driven UX as the
 * outbound flow, but the destination is fixed (the original 3PL
 * cell captured at complete_dispatch time).
 */
export default async function MobileThreePlReturnPage({
  params,
}: {
  params: Promise<{ uuid: string }>;
}) {
  const { uuid } = await params;
  const token = await getDeviceToken();
  if (!token) redirect("/pair");

  const dispatch = await getPendingReturn(uuid);
  if (!dispatch) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="text-lg font-semibold">Return task not found</h1>
        <p className="text-sm text-muted-foreground">
          It may have already been completed by another picker.
        </p>
      </div>
    );
  }

  return <ReturnFlow dispatch={dispatch} />;
}
