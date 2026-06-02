"use client";

import {
  QueryClient,
  QueryClientProvider,
  type QueryClientConfig,
} from "@tanstack/react-query";
import { ReactNode, useState } from "react";

/**
 * Defaults tuned for an internal collab app:
 *
 *  - `networkMode: "online"` — queries pause when the browser reports
 *    offline. No retry spam against an unreachable server.
 *  - `refetchOnReconnect: true` — when the browser comes back online,
 *    every stale query auto-refetches so the UI catches up. Already
 *    the default but spelled out here for documentation.
 *  - `retry: 1` for queries — one quick retry covers a single dropped
 *    packet; beyond that show the error UI instead of stacking spam.
 *  - `retry: 0` for mutations — never silently retry a POST. The user
 *    sees the error and decides.
 */
const config: QueryClientConfig = {
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      networkMode: "online",
      retry: 1,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30_000),
    },
    mutations: {
      networkMode: "online",
      retry: 0,
    },
  },
};

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient(config));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
