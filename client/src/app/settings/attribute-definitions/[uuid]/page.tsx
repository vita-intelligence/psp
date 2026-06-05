import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import { getAttributeDefinition } from "@/lib/attribute-definitions/server";
import { AuditMetaSection } from "@/components/audit/audit-meta-section";
import { AuditHistoryCard } from "@/components/audit/audit-history-card";
import { AttributeDefinitionForm } from "../attribute-definition-form";

export const metadata = { title: "Edit custom attribute · Settings · PSP" };

export default async function EditAttributeDefinitionPage({
  params,
}: {
  params: Promise<{ uuid: string }>;
}) {
  const user = await requireUser();
  if (!hasPermission(user, "items.view")) {
    redirect("/settings/profile");
  }

  const { uuid } = await params;
  const attr = await getAttributeDefinition(uuid);
  if (!attr) notFound();

  const canManage = hasPermission(user, "attribute_definitions.manage");

  return (
    <div className="max-w-3xl space-y-4">
      <Button
        asChild
        variant="ghost"
        size="sm"
        className="text-muted-foreground"
      >
        <Link href="/settings/attribute-definitions">
          <ChevronLeft className="mr-1 size-4" />
          Back to attributes
        </Link>
      </Button>

      <AttributeDefinitionForm attribute={attr} canEdit={canManage} />

      <AuditMetaSection
        inserted_at={attr.inserted_at}
        updated_at={attr.updated_at}
        created_by={attr.created_by}
        updated_by={attr.updated_by}
      />
      <AuditHistoryCard
        entityType="attribute_definition"
        entityId={attr.id}
        canRestore={canManage}
      />
    </div>
  );
}
