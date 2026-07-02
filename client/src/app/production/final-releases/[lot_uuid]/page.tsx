import { notFound, redirect } from "next/navigation";
import { getSessionToken, getCurrentUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { getFinalReleaseByLot } from "@/lib/production-final-release/server";
import { ProductionSubnav } from "../../production-subnav";
import { FinalReleaseForm } from "./final-release-form";
import { PlacementBlockScreen } from "./placement-block";

export const dynamic = "force-dynamic";

export const metadata = { title: "Final Product Release — PSP" };

interface Props {
  params: Promise<{ lot_uuid: string }>;
}

export default async function FinalReleasePage({ params }: Props) {
  const { lot_uuid: lotUuid } = await params;
  const session = await getSessionToken();
  if (!session) {
    redirect(`/login?next=%2Fproduction%2Ffinal-releases%2F${encodeURIComponent(lotUuid)}`);
  }

  const user = await getCurrentUser();
  if (!user) {
    redirect(`/login?next=%2Fproduction%2Ffinal-releases%2F${encodeURIComponent(lotUuid)}`);
  }

  const canRelease = hasPermission(user, "production.final_release");
  const release = await getFinalReleaseByLot(lotUuid);
  if (!release) notFound();

  // Hard-block form entry until the lot has been physically moved into
  // a finished_quarantine cell via the proper scan-lot → scan-cell →
  // photo procedure (the only path that records an audit-grade
  // Stock.Movement with photo evidence). No files, no signatures, no
  // notes editable until the move lands — BRCGS Issue 9 § 5.6 + § 4.4
  // require the lot to physically sit in a finished-quarantine bay
  // during the release ceremony.
  const cellPurpose = release.stock_lot?.placement?.cell_purpose ?? null;
  const lotInFinishedQuarantine = cellPurpose === "finished_quarantine";
  const alreadyFinalized = release.status !== "pending";

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <ProductionSubnav />

      <main className="flex-1 px-4 py-6 sm:px-8">
        {!lotInFinishedQuarantine && !alreadyFinalized ? (
          <div className="mx-auto w-full max-w-3xl">
            <PlacementBlockScreen release={release} lotUuid={lotUuid} />
          </div>
        ) : (
          <div className="mx-auto w-full max-w-4xl">
            <FinalReleaseForm
              initialRelease={release}
              lotUuid={lotUuid}
              currentUserId={user.id}
              currentUserName={user.name ?? user.email ?? "You"}
              canRelease={canRelease}
            />
          </div>
        )}
      </main>
    </div>
  );
}
