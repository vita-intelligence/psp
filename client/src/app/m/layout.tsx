import type { ReactNode } from "react";
import type { Viewport } from "next";
import { getDeviceDisplay } from "@/lib/devices/server";
import { MobileDeviceChannelProvider } from "./mobile-device-channel-provider";

// Lock the /m shell to "full screen, no zoom" so the warehouse phone
// behaves like a native app: pinch-zoom is off and iOS / Android stop
// auto-zooming on input focus. The desktop pages don't share this
// layout so the office UI keeps its normal scaling.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  minimumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

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
