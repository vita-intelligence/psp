import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import { CertificateForm } from "../certificate-form";

export const metadata = { title: "New certificate · Settings · PSP" };

export default async function NewCertificatePage() {
  const user = await requireUser();
  if (!hasPermission(user, "certificates.manage")) {
    redirect("/settings/certificates");
  }

  return (
    <div className="max-w-3xl space-y-4">
      <Button
        asChild
        variant="ghost"
        size="sm"
        className="text-muted-foreground"
      >
        <Link href="/settings/certificates">
          <ChevronLeft className="mr-1 size-4" />
          Back to certificates
        </Link>
      </Button>

      <CertificateForm certificate={null} canEdit />
    </div>
  );
}
