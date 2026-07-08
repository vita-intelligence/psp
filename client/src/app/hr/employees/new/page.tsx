import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { EmployeeForm } from "../../employee-form";

export const metadata = { title: "New employee · HR · PSP" };

export default async function NewEmployeePage() {
  const user = await requireUser();
  if (!hasPermission(user, "hr.create")) {
    redirect("/hr");
  }

  return (
    <div className="max-w-3xl space-y-4">
      <Button
        asChild
        variant="ghost"
        size="sm"
        className="text-muted-foreground"
      >
        <Link href="/hr/employees">
          <ChevronLeft className="mr-1 size-4" />
          Back to employees
        </Link>
      </Button>
      <EmployeeForm employee={null} canEdit />
    </div>
  );
}
