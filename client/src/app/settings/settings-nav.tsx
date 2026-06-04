"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { PermissionCode } from "@/lib/rbac";
import {
  User as UserIcon,
  Building2,
  Tags,
  Users,
  Warehouse,
  ShieldCheck,
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
    href: "/settings/storage-tags",
    label: "Storage tags",
    icon: Tags,
    permission: "warehouses.view",
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
];

/**
 * Sidebar nav at `md:`+ becomes a horizontal scroll strip on mobile so
 * narrow screens still see all sections without nesting. Active item is
 * derived from `usePathname` so links light up after client routing.
 */
export function SettingsNav({ permissions }: { permissions: string[] }) {
  const pathname = usePathname();

  const visible = ITEMS.filter(
    (item) => !item.permission || permissions.includes(item.permission),
  );

  return (
    <nav
      aria-label="Settings sections"
      className="md:sticky md:top-20"
    >
      <ul className="flex flex-row gap-1 overflow-x-auto md:flex-col md:gap-0.5">
        {visible.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
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
