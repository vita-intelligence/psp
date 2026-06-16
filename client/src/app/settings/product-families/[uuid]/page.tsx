import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { getProductFamily } from "@/lib/product-families/server";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ChevronLeft } from "lucide-react";
import { EditModeToggle } from "@/components/forms/edit-mode-toggle";
import { ProductFamilyForm } from "../product-family-form";

export const metadata = { title: "Edit product family · Settings · PSP" };

export default async function EditProductFamilyPage({
  params,
}: {
  params: Promise<{ uuid: string }>;
}) {
  const { uuid } = await params;
  const user = await requireUser();
  if (!hasPermission(user, "items.view")) {
    redirect("/settings/profile");
  }

  const family = await getProductFamily(uuid);
  if (!family) notFound();

  const canEdit = hasPermission(user, "product_families.manage");

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
          <CardTitle>{family.name}</CardTitle>
          <CardDescription>
            {family.code && (
              <span className="font-mono text-xs">{family.code}</span>
            )}
            {!canEdit && (
              <span className="ml-2 text-muted-foreground">
                (read-only — needs{" "}
                <span className="font-mono">product_families.manage</span>)
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EditModeToggle canEdit={canEdit}>
            <ProductFamilyForm family={family} canEdit={canEdit} />
          </EditModeToggle>
        </CardContent>
      </Card>
    </div>
  );
}
