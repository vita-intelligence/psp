import type { ReactNode } from "react";
import { getDeviceDisplay } from "@/lib/devices/server";
import { MobileDeviceChannelProvider } from "./mobile-device-channel-provider";

// Hoists the device WS channel above every /m/* route so pings and
// revoke events land regardless of which mobile page the operator is
// on. Pages that allow session-token fallback (no paired device)
// render without the provider — they just don't get pings.
export default async function MobileLayout({
  children,
}: {
  children: ReactNode;
}) {
  const display = await getDeviceDisplay();

  if (!display) return <>{children}</>;

  return (
    <MobileDeviceChannelProvider deviceUuid={display.device_uuid}>
      {children}
    </MobileDeviceChannelProvider>
  );
}
