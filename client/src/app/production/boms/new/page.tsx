import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ListChecks } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { api } from "@/lib/api";
import { getSessionToken } from "@/lib/auth/server";
import type { Item } from "@/lib/types";
import { ProductionSubnav } from "../../production-subnav";
import { NewBOMFlow } from "./new-bom-flow";

export const metadata = { title: "New BOM · Production · PSP" };

interface Props {
  searchParams: Promise<{ item?: string }>;
}

/**
 * Create a fresh BOM. The output item is required to advance.
 * `?item=<uuid>` (when present — Item detail page injects it) pre-
 * fills the picker; otherwise the operator picks from a searchable
 * dropdown filtered to bommable item types.
 */
export default async function NewBOMPage({ searchParams }: Props) {
  const user = await requireUser();
  if (!hasPermission(user, "production.bom_create")) {
    redirect("/settings/profile");
  }

  const { item } = await searchParams;
  let initialItem: Item | null = null;

  if (item) {
    const token = await getSessionToken();
    if (!token) redirect("/login");
    try {
      const { item: fetched } = await api<{ item: Item }>(
        `/api/items/${encodeURIComponent(item)}`,
        { token, cache: "no-store" },
      );
      initialItem = fetched;
    } catch {
      notFound();
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <ProductionSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-5xl space-y-6">
          <div>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
            >
              <Link href="/production/boms">
                <ChevronLeft className="mr-1 size-4" />
                Back to BOMs
              </Link>
            </Button>
          </div>

          <header className="space-y-1.5">
            <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight sm:text-3xl">
              <ListChecks className="size-6 text-brand" />
              Create BOM
              {initialItem && (
                <span className="text-base font-medium text-muted-foreground">
                  — {initialItem.name}
                </span>
              )}
            </h1>
          </header>

          <NewBOMFlow initialItem={initialItem} />
        </div>
      </main>
    </div>
  );
}
