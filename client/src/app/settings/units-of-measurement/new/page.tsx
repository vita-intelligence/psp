import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import { UnitForm } from "../unit-form";

export const metadata = { title: "New unit · Settings · PSP" };

export default async function NewUnitPage() {
  const user = await requireUser();
  if (!hasPermission(user, "units.manage")) {
    redirect("/settings/units-of-measurement");
  }

  return (
    <div className="max-w-3xl space-y-4">
      <Button
        asChild
        variant="ghost"
        size="sm"
        className="text-muted-foreground"
      >
        <Link href="/settings/units-of-measurement">
          <ChevronLeft className="mr-1 size-4" />
          Back to units
        </Link>
      </Button>

      <UnitForm unit={null} canEdit />
    </div>
  );
}
