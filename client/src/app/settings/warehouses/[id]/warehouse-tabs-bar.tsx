import Link from "next/link";
import { cn } from "@/lib/utils";
import { FileText, LayoutGrid } from "lucide-react";

export type WarehouseTab = "details" | "plan";

interface WarehouseTabsBarProps {
  active: WarehouseTab;
  warehouseUuid: string;
  /** Detail-page base path the tabs link to. Defaults to
   *  `/settings/warehouses` so existing callers keep working;
   *  the production-sites page passes `/settings/production-sites`. */
  basePath?: string;
}

/**
 * Tab nav at the top of the warehouse detail page. State lives in the
 * URL (`?tab=plan` vs default `?tab=details`) so each tab is
 * bookmarkable, peer-shareable, and back-button friendly. Server-only
 * — no client state to hydrate.
 */
export function WarehouseTabsBar({
  active,
  warehouseUuid,
  basePath = "/settings/warehouses",
}: WarehouseTabsBarProps) {
  const items: Array<{ id: WarehouseTab; label: string; icon: typeof FileText }> = [
    { id: "details", label: "Details", icon: FileText },
    { id: "plan", label: "Plan", icon: LayoutGrid },
  ];

  return (
    <nav
      aria-label="Site sections"
      className="flex items-center gap-1 border-b border-border/60"
    >
      {items.map((item) => {
        const isActive = active === item.id;
        const href = `${basePath}/${warehouseUuid}?tab=${item.id}`;
        const Icon = item.icon;
        return (
          <Link
            key={item.id}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "relative inline-flex items-center gap-2 px-3 py-2.5 text-sm font-medium transition-colors",
              isActive
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {item.label}
            {/* Active indicator — sits flush with the parent border so
                the visual treatment matches MRPeasy / Linear nav. */}
            {isActive && (
              <span
                aria-hidden
                className="absolute inset-x-0 -bottom-px h-0.5 bg-foreground"
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
