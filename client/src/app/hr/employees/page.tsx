import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, Users2 } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { listHREmployeesFirstPage } from "@/lib/hr/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { HREmployeesLedger } from "../employees-ledger";

export const metadata = { title: "Employees · HR · PSP" };

export default async function HREmployeesPage() {
    const user = await requireUser();
    if (!hasPermission(user, "hr.view")) {
        redirect("/");
    }

    const initialPage = await listHREmployeesFirstPage();
    const canCreate = hasPermission(user, "hr.create");

    return (
        <>
            <PageHeader
                icon={Users2}
                title="Employees"
                description="Shop-floor workforce master data. Every row carries identity, wage-history timeline, and reputation-event stream. Sessions FK the record so archive is soft-delete."
                backHref="/hr"
                backLabel="Back to HR overview"
                actions={
                    canCreate ? (
                        <Button asChild size="sm">
                            <Link href="/hr/employees/new">
                                <Plus className="mr-1.5 size-4" />
                                New employee
                            </Link>
                        </Button>
                    ) : undefined
                }
            />

            {initialPage ? (
                <HREmployeesLedger initialPage={initialPage} />
            ) : (
                <p className="rounded-md border border-dashed border-border/60 px-4 py-8 text-center text-xs text-muted-foreground">
                    Couldn&apos;t load employees. Please refresh.
                </p>
            )}
        </>
    );
}
