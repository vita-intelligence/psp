import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { getTemplate } from "@/lib/templates/server";
import { getPermissionMatrix } from "@/lib/permissions/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import { TemplateForm } from "../template-form";
import { DeleteTemplateButton } from "./delete-template-button";

interface PageProps {
  params: Promise<{ id: string }>;
}

export const metadata = { title: "Template · Settings · PSP" };

export default async function EditTemplatePage({ params }: PageProps) {
  const user = await requireUser();
  if (!hasPermission(user, "roles.view")) {
    redirect("/settings/profile");
  }

  const { id } = await params;
  const [template, matrix] = await Promise.all([
    getTemplate(id),
    getPermissionMatrix(),
  ]);

  if (!template) notFound();

  const canEdit = hasPermission(user, "roles.edit") && !template.is_system;
  const canDelete = hasPermission(user, "roles.delete") && !template.is_system;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
        >
          <Link href="/settings/roles">
            <ChevronLeft className="mr-1 size-4" />
            Back to templates
          </Link>
        </Button>
        {canDelete && (
          <DeleteTemplateButton uuid={template.uuid} name={template.name} />
        )}
      </div>
      <TemplateForm template={template} matrix={matrix} canEdit={canEdit} />
    </div>
  );
}
