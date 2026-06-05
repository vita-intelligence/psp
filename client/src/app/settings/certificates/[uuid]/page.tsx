import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import { getCertificate } from "@/lib/certificates/server";
import { AuditMetaSection } from "@/components/audit/audit-meta-section";
import { AuditHistoryCard } from "@/components/audit/audit-history-card";
import { CertificateForm } from "../certificate-form";

export const metadata = { title: "Edit certificate · Settings · PSP" };

export default async function EditCertificatePage({
  params,
}: {
  params: Promise<{ uuid: string }>;
}) {
  const user = await requireUser();
  if (!hasPermission(user, "certificates.view")) {
    redirect("/settings/profile");
  }

  const { uuid } = await params;
  const cert = await getCertificate(uuid);
  if (!cert) notFound();

  const canManage = hasPermission(user, "certificates.manage");

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

      <CertificateForm certificate={cert} canEdit={canManage} />

      <AuditMetaSection
        inserted_at={cert.inserted_at}
        updated_at={cert.updated_at}
        created_by={cert.created_by}
        updated_by={cert.updated_by}
      />
      <AuditHistoryCard
        entityType="certificate"
        entityId={cert.id}
        canRestore={canManage}
      />
    </div>
  );
}
