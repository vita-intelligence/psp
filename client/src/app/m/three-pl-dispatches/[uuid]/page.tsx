import { notFound, redirect } from "next/navigation";
import { getDeviceToken } from "@/lib/devices/server";
import { getPendingDispatch } from "@/lib/three-pl/server";
import { DispatchFlow } from "./dispatch-flow";

export const metadata = { title: "Dispatch · PSP Mobile" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ uuid: string }>;
}

export default async function MobileDispatchDetail({ params }: Props) {
  const token = await getDeviceToken();
  if (!token) redirect("/pair");

  const { uuid } = await params;
  const dispatch = await getPendingDispatch(uuid);
  if (!dispatch) notFound();

  return <DispatchFlow dispatch={dispatch} />;
}
