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
import { listCertificatesPage } from "@/lib/certificates/server";
import { CertificatesTable } from "./certificates-table";

export const metadata = { title: "Certificates · Settings · PSP" };

export default async function CertificatesPage() {
  const user = await requireUser();
  if (!hasPermission(user, "certificates.view")) {
    redirect("/settings/profile");
  }

  const initialPage = await listCertificatesPage();
  const canManage = hasPermission(user, "certificates.manage");

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <CardTitle>Certificates</CardTitle>
            <CardDescription>
              Definitions of the certificate types your company tracks. Items
              attach specific instances (with cert number + validity window)
              to one of these.
            </CardDescription>
          </div>
          {canManage && (
            <Button asChild size="sm" className="shrink-0">
              <Link href="/settings/certificates/new">
                <Plus className="mr-1.5 size-4" />
                New certificate
              </Link>
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <CertificatesTable
          initialPage={initialPage ?? { items: [], next_cursor: null }}
        />
      </CardContent>
    </Card>
  );
}
