import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ChevronLeft,
  ClipboardList,
  MailCheck,
  ShieldCheck,
  Truck,
  Undo2,
} from "lucide-react";
import { getDeviceToken } from "@/lib/devices/server";
import {
  listBaileeShipmentsAwaitingPickup,
  listBaileeShipmentsInTransit,
  listBaileeShipmentsNeedingPaperwork,
  listPendingDispatches,
  listPendingReturns,
} from "@/lib/three-pl/server";
import {
  ConfirmTabClient,
  MoveTabClient,
  PaperworkTabClient,
  PickupTabClient,
  ReturnTabClient,
} from "./tabs";

export const metadata = { title: "3PL dispatches · PSP Mobile" };
export const dynamic = "force-dynamic";

type Tab = "move" | "paperwork" | "pickup" | "confirm" | "return";

/**
 * Mobile 3PL hub — five-tab view of every bailee-flow shipment a
 * picker touches during its lifetime. Same operator persona owns
 * every tab (three_pl.dispatch_execute).
 *
 * Rendering split:
 *   * page.tsx (server) — fetches the first paginated page of each
 *     tab in parallel so badge counts render at load AND the active
 *     tab has its initial rows already in SSR HTML.
 *   * tabs.tsx (client) — wraps each row list in the shared
 *     ``<InfiniteList>`` so search + scroll-to-load-more is uniform.
 *
 * Backend list endpoints all accept ``?q=&cursor=&limit=`` — the
 * first-page fetch here uses default page size (25). Subsequent
 * pages fire from the client on scroll.
 */
export default async function MobileThreePlDispatchesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const token = await getDeviceToken();
  if (!token) redirect("/pair");

  const [pending, paperwork, awaitingPickup, inTransit, returns] =
    await Promise.all([
      listPendingDispatches(),
      listBaileeShipmentsNeedingPaperwork(),
      listBaileeShipmentsAwaitingPickup(),
      listBaileeShipmentsInTransit(),
      listPendingReturns(),
    ]);

  const { tab } = await searchParams;
  const active = normaliseTab(tab);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-border/60 bg-background/95 px-3 py-3 backdrop-blur">
        <Link
          href="/m"
          className="rounded-md p-1.5 text-muted-foreground active:bg-muted"
          aria-label="Back to home"
        >
          <ChevronLeft className="size-5" />
        </Link>
        <div className="min-w-0">
          <p className="truncate text-xs uppercase tracking-wider text-muted-foreground">
            3PL dispatches
          </p>
          <p className="truncate text-sm font-semibold">
            {countLabel(pending, paperwork, awaitingPickup, inTransit, returns)}
          </p>
        </div>
      </header>

      <nav
        className="sticky top-[calc(env(safe-area-inset-top)+3.75rem)] z-10 flex border-b border-border/60 bg-background/95 text-xs backdrop-blur"
        aria-label="3PL flow stage"
      >
        <TabLink
          tab="move"
          active={active}
          icon={<Truck />}
          label="Move"
          count={pending.items.length}
          hasMore={pending.next_cursor !== null}
        />
        <TabLink
          tab="paperwork"
          active={active}
          icon={<ClipboardList />}
          label="Paperwork"
          count={paperwork.items.length}
          hasMore={paperwork.next_cursor !== null}
        />
        <TabLink
          tab="pickup"
          active={active}
          icon={<ShieldCheck />}
          label="Pickup"
          count={awaitingPickup.items.length}
          hasMore={awaitingPickup.next_cursor !== null}
        />
        <TabLink
          tab="confirm"
          active={active}
          icon={<MailCheck />}
          label="Confirm"
          count={inTransit.items.length}
          hasMore={inTransit.next_cursor !== null}
        />
        <TabLink
          tab="return"
          active={active}
          icon={<Undo2 />}
          label="Return"
          count={returns.items.length}
          hasMore={returns.next_cursor !== null}
        />
      </nav>

      <main className="flex-1 space-y-3 px-3 py-4">
        {active === "move" && <MoveTabClient initial={pending} />}
        {active === "paperwork" && <PaperworkTabClient initial={paperwork} />}
        {active === "pickup" && <PickupTabClient initial={awaitingPickup} />}
        {active === "confirm" && <ConfirmTabClient initial={inTransit} />}
        {active === "return" && <ReturnTabClient initial={returns} />}
      </main>
    </div>
  );
}

function normaliseTab(raw: string | undefined): Tab {
  if (
    raw === "paperwork" ||
    raw === "pickup" ||
    raw === "confirm" ||
    raw === "return"
  )
    return raw;
  return "move";
}

function TabLink({
  tab,
  active,
  icon,
  label,
  count,
  hasMore,
}: {
  tab: Tab;
  active: Tab;
  icon: React.ReactNode;
  label: string;
  count: number;
  /** Server-side we only load the first page, so ``count`` maxes at
   *  the page size (25). ``+`` next to the badge is our hint that
   *  the tab actually has more waiting once opened. */
  hasMore: boolean;
}) {
  const isActive = active === tab;
  const badge = hasMore ? `${count}+` : `${count}`;
  return (
    <Link
      href={`/m/three-pl-dispatches${tab === "move" ? "" : `?tab=${tab}`}`}
      className={`relative flex flex-1 items-center justify-center px-2 py-3 border-b-2 transition-colors ${
        isActive
          ? "border-brand text-brand"
          : "border-transparent text-muted-foreground active:bg-muted"
      }`}
      role="tab"
      aria-selected={isActive}
      aria-label={`${label} (${badge})`}
      title={label}
    >
      <span className="[&_svg]:size-5">{icon}</span>
      {count > 0 && (
        <span
          className={`absolute -top-0.5 right-1 min-w-[1.1rem] rounded-full border border-background px-1 text-[9px] font-semibold leading-4 tabular-nums text-center ${
            isActive ? "bg-brand text-brand-foreground" : "bg-muted-foreground/60 text-background"
          }`}
        >
          {badge}
        </span>
      )}
    </Link>
  );
}

function countLabel(
  pending: { items: unknown[]; next_cursor: string | null },
  paperwork: { items: unknown[]; next_cursor: string | null },
  awaitingPickup: { items: unknown[]; next_cursor: string | null },
  inTransit: { items: unknown[]; next_cursor: string | null },
  returns: { items: unknown[]; next_cursor: string | null },
): string {
  const total =
    pending.items.length +
    paperwork.items.length +
    awaitingPickup.items.length +
    inTransit.items.length +
    returns.items.length;
  const anyMore =
    pending.next_cursor ||
    paperwork.next_cursor ||
    awaitingPickup.next_cursor ||
    inTransit.next_cursor ||
    returns.next_cursor;
  return `${total}${anyMore ? "+" : ""} in flight`;
}
