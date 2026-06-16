"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import type { PermissionCode } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  User as UserIcon,
  Building2,
  Tags,
  Users,
  Warehouse,
  Factory,
  ShieldCheck,
  Ruler,
  ChevronDown,
  Package,
  Layers,
  Award,
  Settings2,
  Smartphone,
  ListChecks,
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: typeof UserIcon;
  /** Permission required to see this nav item — undefined = always shown. */
  permission?: PermissionCode;
}

const ITEMS: NavItem[] = [
  { href: "/settings/profile", label: "Profile", icon: UserIcon },
  { href: "/settings/devices", label: "Devices", icon: Smartphone },
  {
    href: "/settings/company",
    label: "Company",
    icon: Building2,
    permission: "company.view",
  },
  {
    href: "/settings/warehouses",
    label: "Warehouses",
    icon: Warehouse,
    permission: "warehouses.view",
  },
  {
    href: "/settings/production-sites",
    label: "Production sites",
    icon: Factory,
    permission: "production.facility_view",
  },
  {
    href: "/settings/storage-tags",
    label: "Storage tags",
    icon: Tags,
    permission: "warehouses.view",
  },
  {
    href: "/settings/units-of-measurement",
    label: "Units",
    icon: Ruler,
    permission: "units.view",
  },
  {
    href: "/settings/items",
    label: "Items",
    icon: Package,
    permission: "items.view",
  },
  {
    href: "/settings/product-families",
    label: "Product families",
    icon: Layers,
    permission: "items.view",
  },
  {
    href: "/settings/certificates",
    label: "Certificates",
    icon: Award,
    permission: "certificates.view",
  },
  {
    href: "/settings/attribute-definitions",
    label: "Custom attributes",
    icon: Settings2,
    permission: "items.view",
  },
  {
    href: "/settings/users",
    label: "Users",
    icon: Users,
    permission: "users.view",
  },
  {
    href: "/settings/roles",
    label: "Templates",
    icon: ShieldCheck,
    permission: "roles.view",
  },
  {
    href: "/queues",
    label: "Queues",
    icon: ListChecks,
    permission: "items.view",
  },
];

/**
 * Settings nav with two layouts:
 *   * `md:` and up — sticky vertical sidebar.
 *   * Below `md:` — a single button trigger that opens a dropdown menu
 *     with the visible sections stacked. Avoids the "7 tabs on a
 *     horizontal strip" overflow problem on phones, and keeps the
 *     selected section visible in the trigger label so the user always
 *     knows where they are.
 *
 * Permission filtering happens once; the same `visible` list feeds
 * both layouts. The backend already collapses `is_admin → full perm
 * registry` in `RBAC.effective_permissions/1`, so a simple `includes`
 * check is correct on the FE.
 */
export function SettingsNav({ permissions }: { permissions: string[] }) {
  const pathname = usePathname();
  const router = useRouter();

  const visible = ITEMS.filter(
    (item) => !item.permission || permissions.includes(item.permission),
  );

  const active =
    visible.find(
      (item) =>
        pathname === item.href || pathname.startsWith(`${item.href}/`),
    ) ?? visible[0];

  return (
    <nav aria-label="Settings sections" className="md:sticky md:top-20">
      {/* Mobile: dropdown trigger showing current section. Full-width
          so it's easy to tap; the chevron + active icon make it
          immediately readable as a menu. */}
      <div className="md:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className="w-full justify-between"
            >
              <span className="inline-flex items-center gap-2">
                {active && <active.icon className="size-4" />}
                <span>{active?.label ?? "Settings"}</span>
              </span>
              <ChevronDown className="size-4 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-56">
            {visible.map((item) => {
              const isActive =
                pathname === item.href ||
                pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <DropdownMenuItem
                  key={item.href}
                  onSelect={() => router.push(item.href)}
                  className={cn(
                    "gap-2",
                    isActive && "bg-muted font-medium text-foreground",
                  )}
                >
                  <Icon className="size-4" />
                  <span>{item.label}</span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Desktop: classic vertical sidebar. */}
      <ul className="hidden flex-col gap-0.5 md:flex">
        {visible.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
