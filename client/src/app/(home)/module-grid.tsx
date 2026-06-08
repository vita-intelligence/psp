import {
  Boxes,
  ListChecks,
  Package,
  Settings as SettingsIcon,
  Warehouse,
} from "lucide-react";
import type { User } from "@/lib/types";
import { hasPermission } from "@/lib/rbac";
import { ModuleTile } from "./module-tile";

/**
 * Top-of-home launcher. Each tile gates on the same permission as
 * the module's index page so a user without access doesn't see a
 * dead link. Admins see everything (rbac.ts short-circuits on
 * `is_admin`).
 */
export function ModuleGrid({ user }: { user: User }) {
  const tiles = [
    {
      key: "stock",
      href: "/stock",
      label: "Stock",
      Icon: Boxes,
      caption: "Lots & movements",
      // Gated on `stock.view`. Until the backend registers and
      // grants the permission to operations roles, only admins
      // (is_admin bypass) see the tile.
      gate: hasPermission(user, "stock.view"),
    },
    {
      key: "items",
      href: "/settings/items",
      label: "Items",
      Icon: Package,
      caption: "Catalogue",
      gate: hasPermission(user, "items.view"),
    },
    {
      key: "warehouses",
      href: "/settings/warehouses",
      label: "Warehouses",
      Icon: Warehouse,
      caption: "Floor plans",
      gate: hasPermission(user, "warehouses.view"),
    },
    {
      key: "queues",
      href: "/queues",
      label: "Queues",
      Icon: ListChecks,
      caption: "Reviews & expiry",
      gate: hasPermission(user, "items.view"),
    },
    {
      key: "settings",
      href: "/settings",
      label: "Settings",
      Icon: SettingsIcon,
      caption: "Company & users",
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
