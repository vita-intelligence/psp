"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { Bell, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  disconnectDeviceSocket,
  getDeviceSocket,
} from "@/lib/realtime/device-socket";

interface PingPayload {
  message: string;
  sent_at: string;
}

interface DeviceChannelState {
  connected: boolean;
}

const DeviceChannelContext = createContext<DeviceChannelState | null>(null);

// Safe to call from any /m/* descendant. Returns `connected: false` when
// no provider is mounted (e.g. session-token-only access without a
// paired device) so consumers can render an "offline" badge without a
// null check.
export function useDeviceChannel(): DeviceChannelState {
  return useContext(DeviceChannelContext) ?? { connected: false };
}

interface Props {
  deviceUuid: string;
  children: ReactNode;
}

export function MobileDeviceChannelProvider({ deviceUuid, children }: Props) {
  const router = useRouter();
  const [connected, setConnected] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const channelRef = useRef<{ leave: () => void } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const socket = await getDeviceSocket();
      if (!socket || cancelled) return;

      const channel = socket.channel(`device:${deviceUuid}`, {});

      channel.on("ping", (payload: PingPayload) => {
        toast.message(payload.message, {
          icon: <Bell className="size-4" />,
          description: new Date(payload.sent_at).toLocaleTimeString(),
        });
      });

      channel.on("revoked", () => {
        setRevoked(true);
        disconnectDeviceSocket();
      });

      channel
        .join()
        .receive("ok", () => setConnected(true))
        .receive("error", () => setConnected(false));

      socket.onError(() => setConnected(false));
      socket.onOpen(() => {
        if (channelRef.current) setConnected(true);
      });

      channelRef.current = channel;
    })();

    return () => {
      cancelled = true;
      channelRef.current?.leave();
      channelRef.current = null;
    };
  }, [deviceUuid]);

  if (revoked) {
    return <RevokedScreen onPairAgain={() => signOutAndPair(router)} />;
  }

  return (
    <DeviceChannelContext.Provider value={{ connected }}>
      {children}
    </DeviceChannelContext.Provider>
  );
}

function RevokedScreen({ onPairAgain }: { onPairAgain: () => void }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <WifiOff className="size-8 text-destructive" />
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Device revoked</h1>
        <p className="text-sm text-muted-foreground">
          This device was signed out from your laptop. Pair again with a
          fresh code to continue.
        </p>
      </div>
      <Button onClick={onPairAgain}>Pair again</Button>
    </div>
  );
}

async function signOutAndPair(router: ReturnType<typeof useRouter>) {
  disconnectDeviceSocket();
  await fetch("/api/device/sign-out", { method: "POST" });
  router.replace("/pair");
}
