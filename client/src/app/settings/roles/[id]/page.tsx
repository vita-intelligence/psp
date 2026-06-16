import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { getTemplate } from "@/lib/templates/server";
import { getPermissionMatrix } from "@/lib/permissions/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import { EditModeToggle } from "@/components/forms/edit-mode-toggle";
import { TemplateForm } from "../template-form";
import { DeleteTemplateButton } from "./delete-template-button";
import { AuditMetaSection } from "@/components/audit/audit-meta-section";
import { AuditHistoryCard } from "@/components/audit/audit-history-card";

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
    // max-w-3xl pins the whole stack — form + ownership + activity —
    // to one width so they line up edge-to-edge. The form's live-
    // cursor coords are anchored to the form Card, but every editor
    // sees the same Card width because the parent caps it.
    <div className="max-w-3xl space-y-4">
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
      <EditModeToggle canEdit={canEdit}>
        <TemplateForm template={template} matrix={matrix} canEdit={canEdit} />
      </EditModeToggle>
      <AuditMetaSection
        inserted_at={template.inserted_at}
        updated_at={template.updated_at}
        created_by={template.created_by}
        updated_by={template.updated_by}
      />
      <AuditHistoryCard
        entityType="template"
        entityId={template.id}
        canRestore={canEdit}
      />
    </div>
  );
}
