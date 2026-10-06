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

// Shared safe-area wrapper for every /m/* page. ``viewport-fit=cover``
// (set above) extends the page under the iPhone notch + home-indicator
// bar so cards slide behind native chrome when installed as a PWA.
// Padding by ``env(safe-area-inset-*)`` pushes the content back into
// the actually-visible rectangle without stretching layouts on
// non-notched devices (``env()`` falls back to 0). Each page's
// ``sticky top-0`` header sticks to the bottom of this padding, which
// is the correct answer on both notched (clears the island) and
// non-notched (touches the top edge) phones.
function MobileSafeAreaFrame({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex min-h-dvh flex-col"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      {children}
    </div>
  );
}

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

  if (!display) {
    return <MobileSafeAreaFrame>{children}</MobileSafeAreaFrame>;
  }

  return (
    <MobileDeviceChannelProvider deviceUuid={display.device_uuid}>
      <MobileSafeAreaFrame>{children}</MobileSafeAreaFrame>
    </MobileDeviceChannelProvider>
  );
}
