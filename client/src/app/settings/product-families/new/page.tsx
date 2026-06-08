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
import { ChevronLeft } from "lucide-react";
import { ProductFamilyForm } from "../product-family-form";

export const metadata = { title: "New product family · Settings · PSP" };

export default async function NewProductFamilyPage() {
  const user = await requireUser();
  if (!hasPermission(user, "product_families.manage")) {
    redirect("/settings/product-families");
  }

  return (
    <div className="space-y-4">
      <div>
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
        >
          <Link href="/settings/product-families">
            <ChevronLeft className="mr-1 size-4" />
            Back to families
          </Link>
        </Button>
      </div>
      <Card className="border-border/60">
        <CardHeader>
          <CardTitle>New product family</CardTitle>
          <CardDescription>
            Group SKU variants under one product. Operators see this on
            the item-form picker and on the items list.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProductFamilyForm family={null} canEdit />
        </CardContent>
      </Card>
    </div>
  );
}
