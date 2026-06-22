"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Camera,
  ClipboardCheck,
  LogOut,
  Package,
  PackageCheck,
  PackageOpen,
  Truck,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/brand/wordmark";
import { disconnectDeviceSocket } from "@/lib/realtime/device-socket";
import type { DeviceDisplay } from "@/lib/devices/server";
import { useDeviceChannel } from "./mobile-device-channel-provider";

interface Props {
  display: DeviceDisplay;
  /** Permission strings the viewer holds (e.g. `["stock.move",
   *  "goods_in.inspect"]`). Source of truth for which tiles render —
   *  not present = tile hidden, per the project-wide RBAC rule. */
  viewerPermissions: string[];
  /** Admins bypass per-tile permission gates (mirrors the server-side
   *  `hasPermission` short-circuit). */
  isAdmin: boolean;
  pendingPutawayCount: number;
  incomingTodayCount: number;
  submittedInspectionCount: number;
}

/**
 * Tile registry — the single source of truth for what lives on the
 * mobile home menu. Each tile gets:
 *
 *   * `permission`: the RBAC key the viewer must hold (or admin). The
 *     null tile (Scan) is unconditional because scanning a QR just
 *     navigates — the downstream page enforces its own permission.
 *   * `badgeKey`: which prop on the home shell carries the count
 *     (drives the small chip in the corner; `null` ⇒ no badge).
 *
 * Exported so a smoke-test can assert the matrix without rendering
 * a single React tree.
 */
export const MOBILE_HOME_TILES = [
  {
    key: "putaway",
    href: "/m/putaway",
    label: "Pending put-away",
    description: "Move incoming lots to a shelf",
    icon: Package,
    permission: "stock.move",
    badgeKey: "pendingPutawayCount",
  },
  {
    key: "incoming",
    href: "/m/incoming",
    label: "Goods-in",
    description: "Inspect today's deliveries",
    icon: Truck,
    permission: "goods_in.inspect",
    badgeKey: "incomingTodayCount",
  },
  {
    key: "inspections",
    href: "/m/inspections",
    label: "Inspections",
    description: "Review, sign off, re-print labels",
    icon: ClipboardCheck,
    // `goods_in.view` covers everyone who needs to look at the
    // ledger. Approvers see "Needs sign-off" chip + badge; pure
    // viewers see "Mine" / "All recent" only — the list page enforces
    // the perm-aware chip set client-side.
    permission: "goods_in.view",
    badgeKey: "submittedInspectionCount",
  },
  {
    key: "pickup",
    href: "/m/pickup",
    label: "Pickup queue",
    description: "Pick released MOs for production",
    icon: PackageOpen,
    permission: "warehouse.pick",
    badgeKey: null,
  },
  {
    key: "preflight",
    href: "/m/preflight",
    label: "Pre-production",
    description: "Verify ingredient qty + quality before start",
    icon: ClipboardCheck,
    permission: "production.preflight",
    badgeKey: null,
  },
  {
    key: "closeout",
    href: "/m/closeout",
    label: "Closeout",
    description: "Hand off after production — scan, photo, qty",
    icon: PackageCheck,
    permission: "production.closeout",
    badgeKey: null,
  },
  {
    key: "scan",
    href: "/m/scan",
    label: "Scan QR",
    description: "Cell, lot, or label",
    icon: Camera,
    permission: null,
    badgeKey: null,
  },
] as const;

export type MobileHomeTile = (typeof MOBILE_HOME_TILES)[number];

/**
 * Returns the tiles this user should see on the mobile home. Same
 * predicate used by the home shell + the rendering of any direct-
 * link guards on the destination pages. Pulled into a helper so the
 * RBAC smoke test can assert it without simulating React.
 *
 * Rule:
 *   * Tile.permission = null ⇒ always shown.
 *   * Admin user ⇒ everything shown.
 *   * Otherwise the permission string must be in the viewer's set.
 *
 * The "permission stack on top of view" check (e.g. don't show
 * "QC sign-off" if the user already has `goods_in.approve` — which
 * implies they can also `inspect` and `view`) is intentional
 * duplication: the four tiles each route to a different default
 * filter on /m/incoming, not the same screen.
 */
export function visibleMobileTiles(
  permissions: readonly string[],
  isAdmin: boolean,
): MobileHomeTile[] {
  return MOBILE_HOME_TILES.filter((tile) => {
    if (tile.permission === null) return true;
    if (isAdmin) return true;
    return permissions.includes(tile.permission);
  });
}

export function MobileHomeShell({
  display,
  viewerPermissions,
  isAdmin,
  pendingPutawayCount,
  incomingTodayCount,
  submittedInspectionCount,
}: Props) {
  const router = useRouter();
  const { connected } = useDeviceChannel();

  const badgeFor = (
    key: MobileHomeTile["badgeKey"],
  ): number | null => {
    if (key === "pendingPutawayCount") return pendingPutawayCount;
    if (key === "incomingTodayCount") return incomingTodayCount;
    if (key === "submittedInspectionCount") return submittedInspectionCount;
    return null;
  };

  const tiles = visibleMobileTiles(viewerPermissions, isAdmin);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <Wordmark />
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {connected ? (
            <Wifi className="size-3.5 text-emerald-500" />
          ) : (
            <WifiOff className="size-3.5 text-amber-500" />
          )}
        </div>
      </header>

      <main className="flex-1 space-y-4 px-4 py-5">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            {display.user_name}
          </p>
          <p className="text-sm font-medium">{display.device_label}</p>
        </div>

        {tiles.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 px-4 py-12 text-center">
            <p className="text-sm font-medium">No actions available</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Your role doesn&apos;t include any mobile actions yet. Ask
              an admin to grant `stock.move`, `goods_in.inspect`, or a
              related permission.
            </p>
          </div>
        ) : (
          <ul
            className="grid grid-cols-2 gap-3"
            data-testid="mobile-home-tiles"
          >
            {tiles.map((tile) => {
              const Icon = tile.icon;
              const badge = badgeFor(tile.badgeKey);
              return (
                <li key={tile.key}>
                  <Link
                    href={tile.href}
                    data-tile-key={tile.key}
                    className="flex aspect-square flex-col items-start justify-between rounded-lg border border-border/60 bg-card p-3 active:bg-muted"
                  >
                    <div className="flex w-full items-start justify-between">
                      <span className="grid size-9 place-items-center rounded-full bg-brand/15 text-brand">
                        <Icon className="size-5" />
                      </span>
                      {badge !== null && badge > 0 && (
                        <span
                          data-testid={`badge-${tile.key}`}
                          className="inline-flex min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-semibold text-destructive-foreground"
                        >
                          {badge}
                        </span>
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-semibold leading-tight">
                        {tile.label}
                      </p>
                      <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">
                        {tile.description}
                      </p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>

      <footer className="border-t border-border/60 px-4 py-3">
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-muted-foreground"
          onClick={() => signOutAndPair(router)}
        >
          <LogOut className="mr-1.5 size-4" />
          Sign this device out
        </Button>
      </footer>
    </div>
  );
}

async function signOutAndPair(router: ReturnType<typeof useRouter>) {
  disconnectDeviceSocket();
  await fetch("/api/device/sign-out", { method: "POST" });
  router.replace("/pair");
}
