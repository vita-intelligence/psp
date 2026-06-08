import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Plus } from "lucide-react";
import { listProductFamiliesPage } from "@/lib/product-families/server";
import { ProductFamiliesTable } from "./product-families-table";

export const metadata = { title: "Product families · Settings · PSP" };

export default async function ProductFamiliesPage() {
  const user = await requireUser();
  if (!hasPermission(user, "items.view")) {
    redirect("/settings/profile");
  }

  const initialPage = await listProductFamiliesPage();
  const canEdit = hasPermission(user, "product_families.manage");

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <CardTitle>Product families</CardTitle>
            <CardDescription>
              Marketing-level grouping of variant SKUs. One family per
              product (e.g. <em>Vitamin C</em>) holds all its variants
              (capsule, tablet, powder, flavoured…). Optional — items
              can live family-less.
            </CardDescription>
          </div>
          {canEdit && (
            <Button asChild size="sm" className="shrink-0">
              <Link href="/settings/product-families/new">
                <Plus className="mr-1.5 size-4" />
                New family
              </Link>
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <ProductFamiliesTable
          initialPage={initialPage ?? { items: [], next_cursor: null }}
        />
      </CardContent>
    </Card>
  );
}
