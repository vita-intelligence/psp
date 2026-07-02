import { notFound, redirect } from "next/navigation";
import { getSessionToken, getCurrentUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { getFinalReleaseByLot } from "@/lib/production-final-release/server";
import { FinalReleaseForm } from "./final-release-form";

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

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      <FinalReleaseForm
        initialRelease={release}
        lotUuid={lotUuid}
        currentUserId={user.id}
        currentUserName={user.name ?? user.email ?? "You"}
        canRelease={canRelease}
      />
    </div>
  );
}
