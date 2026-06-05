import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import { AttributeDefinitionForm } from "../attribute-definition-form";

export const metadata = { title: "New custom attribute · Settings · PSP" };

export default async function NewAttributeDefinitionPage() {
  const user = await requireUser();
  if (!hasPermission(user, "attribute_definitions.manage")) {
    redirect("/settings/attribute-definitions");
  }

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

      <AttributeDefinitionForm attribute={null} canEdit />
    </div>
  );
}
