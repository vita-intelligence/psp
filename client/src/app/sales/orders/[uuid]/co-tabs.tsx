"use client";

/**
 * Tab switcher above the CO detail view. Two tabs:
 *
 *   - Wizard — the single-page "do this next" projection (default
 *     post-submission).
 *   - Detail — the existing workflow card + lines card + comments +
 *     audit (default while still in draft).
 *
 * Tab state lives in `?tab=wizard|detail` so a peer / refresh keeps
 * the user where they were. The two children are pre-rendered server
 * markup that we toggle with CSS so we don't lose scroll position or
 * input state on switch.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Cog, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CompanyDefaults, OrderWizardSnapshot } from "@/lib/types";
import { WizardTab } from "./wizard-tab";

type Tab = "wizard" | "detail";

interface Props {
  coUuid: string;
  defaultTab: Tab;
  wizard: OrderWizardSnapshot | null;
  prefs: CompanyDefaults;
  /** The existing detail content (workflow card, header card, lines
   *  card, comments, audit). Rendered server-side, passed in as a
   *  React node so this client component stays focused on tab state. */
  detail: React.ReactNode;
}

export function CoTabs({ coUuid, defaultTab, wizard, prefs, detail }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromUrl = searchParams.get("tab");
  const initial: Tab =
    fromUrl === "wizard" || fromUrl === "detail" ? fromUrl : defaultTab;
  const [active, setActive] = useState<Tab>(initial);

  // Sync URL forward when the user clicks a tab. We use replaceState
  // so the back button doesn't fill up with tab toggles.
  const setTab = useCallback(
    (next: Tab) => {
      setActive(next);
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", next);
      window.history.replaceState(
        null,
        "",
        `/sales/orders/${coUuid}?${params.toString()}`,
      );
    },
    [coUuid, searchParams],
  );

  // Called by the wizard when a scroll_to CTA fires: flip to Detail
  // then scroll the target into view on the next paint.
  const switchToDetail = useCallback(
    (target?: string) => {
      setTab("detail");
      if (!target) return;
      // Wait a frame for the detail tab to mount + lay out before
      // measuring. Two RAFs to be safe across browsers.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const el = document.querySelector(target);
          if (el instanceof HTMLElement) {
            el.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        });
      });
    },
    [setTab],
  );

  // If the URL changes externally (back/forward), follow.
  useEffect(() => {
    const fromUrlNow = searchParams.get("tab");
    if (fromUrlNow === "wizard" || fromUrlNow === "detail") {
      if (fromUrlNow !== active) setActive(fromUrlNow);
    }
  }, [searchParams, active]);

  // Surface a refresh hook for child actions — the wizard refreshes
  // after an action and we want both tabs to re-render with fresh
  // server data.
  useEffect(() => {
    // No-op; documented to make intent explicit. Server-action
    // revalidations already trigger a router.refresh() upstream.
    void router;
  }, [router]);

  return (
    <div className="space-y-6">
      <nav
        aria-label="Order view"
        className="flex items-center gap-1 border-b border-border/60"
      >
        <TabButton
          label="Wizard"
          icon={Cog}
          isActive={active === "wizard"}
          onClick={() => setTab("wizard")}
        />
        <TabButton
          label="Detail"
          icon={FileText}
          isActive={active === "detail"}
          onClick={() => setTab("detail")}
        />
      </nav>

      {/* Render both panes; toggle visibility so scroll position +
          form state on the detail tab survive tab switches. */}
      <div className={cn(active === "wizard" ? "block" : "hidden")}>
        <WizardTab
          wizard={wizard}
          prefs={prefs}
          onSwitchToDetail={switchToDetail}
        />
      </div>
      <div className={cn(active === "detail" ? "block" : "hidden")}>
        {detail}
      </div>
    </div>
  );
}

function TabButton({
  label,
  icon: Icon,
  isActive,
  onClick,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "relative inline-flex items-center gap-2 px-3 py-2.5 text-sm font-medium transition-colors",
        isActive
          ? "text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="size-4" />
      {label}
      {isActive && (
        <span
          aria-hidden
          className="absolute inset-x-0 -bottom-px h-0.5 bg-foreground"
        />
      )}
    </button>
  );
}
