import {
  Boxes,
  Factory,
  Settings as SettingsIcon,
  ShoppingCart,
} from "lucide-react";
import type { User } from "@/lib/types";
import { hasPermission } from "@/lib/rbac";
import { ModuleTile } from "./module-tile";

/**
 * Top-of-home launcher. Reduced to operational top-level modules:
 * Stock + Procurement + Settings. Catalogue concerns (Items,
 * Warehouses, Storage tags, Units, etc.) and the review/expiry
 * queues live under Settings — they're configuration, not
 * day-to-day operations, so they don't earn home-grid real estate.
 */
export function ModuleGrid({ user }: { user: User }) {
  const tiles = [
    {
      key: "stock",
      href: "/stock",
      label: "Stock",
      Icon: Boxes,
      caption: "Lots & movements",
      gate: hasPermission(user, "stock.view"),
    },
    {
      key: "procurement",
      href: "/procurement",
      label: "Procurement",
      Icon: ShoppingCart,
      caption: "Vendors, POs, invoices",
      gate: hasPermission(user, "vendors.view"),
    },
    {
      key: "production",
      href: "/production",
      label: "Production",
      Icon: Factory,
      caption: "BOMs, manufacturing, routings",
      gate: hasPermission(user, "production.bom_view"),
    },
    {
      key: "settings",
      href: "/settings",
      label: "Settings",
      Icon: SettingsIcon,
      caption: "Company, catalogue, queues",
      gate: true,
    },
  ].filter((t) => t.gate);

  return (
    <section aria-label="Modules">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5">
        {tiles.map((t) => (
          <ModuleTile
            key={t.key}
            href={t.href}
            label={t.label}
            Icon={t.Icon}
            caption={t.caption}
          />
        ))}
      </div>
    </section>
  );
}
