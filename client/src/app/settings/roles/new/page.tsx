import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { getPermissionMatrix } from "@/lib/permissions/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import { TemplateForm } from "../template-form";

export const metadata = { title: "New template · Settings · PSP" };

export default async function NewTemplatePage() {
  const user = await requireUser();
  if (!hasPermission(user, "roles.create")) {
    redirect("/settings/roles");
  }

  const matrix = await getPermissionMatrix();

  return (
    <div className="max-w-3xl space-y-4">
      <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
        <Link href="/settings/roles">
          <ChevronLeft className="mr-1 size-4" />
          Back to templates
        </Link>
      </Button>
      <TemplateForm template={null} matrix={matrix} canEdit />
    </div>
  );
}
