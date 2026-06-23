import { notFound, redirect } from "next/navigation";
import { getSessionToken } from "@/lib/auth/server";
import { getDeviceToken } from "@/lib/devices/server";
import {
  getLooseDispatchLots,
  getReturnPickupDetail,
  getReturnPickupTrolley,
} from "@/lib/warehouse-return-pickup/server";
import { getCompanyDefaults } from "@/lib/company/server";
import { ReturnPickupFlow } from "./return-pickup-flow";

type Params = { mo_uuid: string };

export const metadata = { title: "Return pickup · PSP Mobile" };
export const dynamic = "force-dynamic";

const LOOSE_KEY = "__loose__";

export default async function MobileReturnPickupDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const [deviceToken, sessionToken] = await Promise.all([
    getDeviceToken(),
    getSessionToken(),
  ]);
  const { mo_uuid } = await params;
  if (!deviceToken && !sessionToken)
    redirect(`/login?next=%2Fm%2Freturn-pickup%2F${mo_uuid}`);

  const company = await getCompanyDefaults();

  if (mo_uuid === LOOSE_KEY || mo_uuid === "loose") {
    const [loose, trolley] = await Promise.all([
      getLooseDispatchLots(),
      getReturnPickupTrolley(),
    ]);
    return (
      <ReturnPickupFlow
        mode="loose"
        initialMo={null}
        initialLots={loose?.items ?? []}
        initialTrolley={trolley?.items ?? []}
        initialOthers={trolley?.others ?? []}
        companyDateFormat={company}
      />
    );
  }

  const detail = await getReturnPickupDetail(mo_uuid);
  if (!detail) notFound();

  return (
    <ReturnPickupFlow
      mode="mo"
      initialMo={detail.mo}
      initialLots={detail.lots_at_dispatch}
      initialTrolley={detail.trolley}
      initialOthers={detail.trolley_others}
      companyDateFormat={company}
    />
  );
}
