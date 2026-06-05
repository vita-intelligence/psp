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
import { listAttributeDefinitionsPage } from "@/lib/attribute-definitions/server";
import { AttributesTable } from "./attributes-table";

export const metadata = { title: "Custom attributes · Settings · PSP" };

export default async function AttributeDefinitionsPage() {
  const user = await requireUser();
  // Read is shared with items.view — anyone who can see items needs to
  // see which attributes exist so the form scaffolds correctly. Write
  // is gated below.
  if (!hasPermission(user, "items.view")) {
    redirect("/settings/profile");
  }

  const initialPage = await listAttributeDefinitionsPage();
  const canManage = hasPermission(user, "attribute_definitions.manage");

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <CardTitle>Custom attributes</CardTitle>
            <CardDescription>
              Admin-extensible typed extension fields per item type. Values
              live in `items.attributes`; the items form renders the right
              inputs automatically based on the attribute&apos;s scope and
              type.
            </CardDescription>
          </div>
          {canManage && (
            <Button asChild size="sm" className="shrink-0">
              <Link href="/settings/attribute-definitions/new">
                <Plus className="mr-1.5 size-4" />
                New attribute
              </Link>
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <AttributesTable
          initialPage={initialPage ?? { items: [], next_cursor: null }}
        />
      </CardContent>
    </Card>
  );
}
