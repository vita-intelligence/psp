import { redirect } from "next/navigation";
import { getDeviceDisplay, getDeviceToken } from "@/lib/devices/server";
import { MobileShell } from "./mobile-shell";

export const metadata = { title: "PSP Mobile" };

export default async function MobileHome() {
  const token = await getDeviceToken();
  if (!token) redirect("/pair");

  // The display blob is set alongside the device bearer at claim time
  // (`{user, device}`). If the cookie's been cleared but the bearer
  // is still present, send the user back to /pair to re-establish a
  // clean shell. Cheap escape hatch — the alternative is a backend
  // call on every render.
  const display = await getDeviceDisplay();
  if (!display) redirect("/pair");

  return <MobileShell display={display} />;
}
