import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import { getItem } from "@/lib/items/server";
import { listUnitsOfMeasurement } from "@/lib/units/server";
import {
  listActiveAttributeDefinitionsForScope,
  listProductFamiliesForPicker,
} from "@/lib/catalogs/server";
import { listAllergens } from "@/lib/allergens/server";
import { listCertificatesForPicker } from "@/lib/certificates/server";
import { listStorageTags } from "@/lib/storage-tags/server";
import { AuditMetaSection } from "@/components/audit/audit-meta-section";
import { AuditHistoryCard } from "@/components/audit/audit-history-card";
import { ItemForm } from "../item-form";
import { ItemImagesSection } from "../images/item-images-section";
import { ItemCertificatesSection } from "../certificates/item-certificates-section";

export const metadata = { title: "Edit item · Settings · PSP" };

export default async function EditItemPage({
  params,
}: {
  params: Promise<{ uuid: string }>;
}) {
  const user = await requireUser();
  if (!hasPermission(user, "items.view")) {
    redirect("/settings/profile");
  }

  const { uuid } = await params;
  const item = await getItem(uuid);
  if (!item) notFound();

  const [
    units,
    families,
    attributeDefinitions,
    allergens,
    certificates,
    storageTags,
  ] = await Promise.all([
    listUnitsOfMeasurement(),
    listProductFamiliesForPicker(),
    listActiveAttributeDefinitionsForScope(item.item_type),
    listAllergens(),
    listCertificatesForPicker(),
    listStorageTags(),
  ]);

  const canEdit = hasPermission(user, "items.edit");
  const canEditRisk = hasPermission(user, "risk_assessments.create");
  const canApproveRisk = hasPermission(user, "risk_assessments.approve");

  return (
    // max-w-3xl pins form + satellites + audit cards to one width so
    // they line up edge-to-edge and the live-cursor anchor stays
    // pixel-stable across collaborators on different viewports.
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
        >
          <Link href="/settings/items">
            <ChevronLeft className="mr-1 size-4" />
            Back to items
          </Link>
        </Button>
      </div>

      {/* Image gallery — non-realtime satellite. Uploads + delete are
          synchronous per-action; the list refreshes after each save. */}
      <ItemImagesSection item={item} canEdit={canEdit} />

      {/* Mega-form: identity + per-type compliance + risk + spec +
          packaging. One useLiveForm room, one save, atomic transaction. */}
      <ItemForm
        item={item}
        canEdit={canEdit}
        canEditRisk={canEditRisk}
        canApproveRisk={canApproveRisk}
        units={units ?? []}
        families={families ?? []}
        attributeDefinitions={attributeDefinitions ?? []}
        allAllergens={allergens ?? []}
        storageTags={storageTags ?? []}
      />

      {/* Certificate attachments are M:N with per-row state. */}
      <ItemCertificatesSection
        item={item}
        canEdit={canEdit}
        certificates={certificates ?? []}
      />

      <AuditMetaSection
        inserted_at={item.inserted_at}
        updated_at={item.updated_at}
        created_by={item.created_by}
        updated_by={item.updated_by}
      />
      <AuditHistoryCard
        entityType="item"
        entityId={item.id}
        canRestore={canEdit}
      />
    </div>
  );
}
