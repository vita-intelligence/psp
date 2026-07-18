import { notFound, redirect } from "next/navigation";
import { Package } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PageHeader } from "@/components/layout/page-header";
import { PresenceMount } from "@/components/realtime/presence-mount";
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
import { EditModeToggle } from "@/components/forms/edit-mode-toggle";
import { ProductionSubnav } from "../../production-subnav";
import { ItemForm } from "../item-form";
import { ItemImagesSection } from "../images/item-images-section";
import { ItemCertificatesSection } from "../certificates/item-certificates-section";
import { ItemBOMsCard } from "./item-boms-card";

export const metadata = { title: "Edit item · Production · PSP" };

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
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <ProductionSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        {/* max-w-7xl matches Manufacturing orders / BOMs / Routings so
            the whole /production/* module reads at one width. The item
            form + satellites + audit cards all stretch to the full
            container; the live-cursor overlay is anchored to the
            form's own ``card ref`` (not to the page) so wider outer
            container doesn't break peer cursor sync. */}
        <div className="mx-auto max-w-7xl space-y-6">
          <PageHeader
            icon={Package}
            size="detail"
            title={item.name}
            description={item.code ?? undefined}
            backHref="/production/items"
            backLabel="Back to items"
          />

          {/* Image gallery — non-realtime satellite. Uploads + delete
              are synchronous per-action; list refreshes after each save. */}
          <ItemImagesSection item={item} canEdit={canEdit} />

          {/* Mega-form: identity + per-type compliance + risk + spec +
              packaging. One useLiveForm room, one save, atomic tx. */}
          <EditModeToggle canEdit={canEdit}>
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
          </EditModeToggle>

          {/* Certificate attachments are M:N with per-row state. */}
          <ItemCertificatesSection
            item={item}
            canEdit={canEdit}
            certificates={certificates ?? []}
          />

          {/* BOMs — visible only when the item's `item_type` is
              bommable (finished_product or semi_finished). Server-
              side enforces the same rule in
              `Backend.Production.create_bom/2`. */}
          <ItemBOMsCard
            item={item}
            canCreate={hasPermission(user, "production.bom_create")}
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
      </main>
    </div>
  );
}
