import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { getCompany } from "@/lib/company/server";
import { hasPermission } from "@/lib/rbac";
import { CompanyIdentityForm } from "./company-identity-form";
import { CompanyLocaleForm } from "./company-locale-form";
import { WorkingHoursForm } from "./working-hours-form";
import { HolidaysForm } from "./holidays-form";
import { CurrencyRatesForm } from "./currency-rates-form";
import { AllowedIpsForm } from "./allowed-ips-form";
import { NumberingFormatsForm } from "./numbering-formats-form";
import { WarehousePickupForm } from "./warehouse-pickup-form";
import { ThreePlRateForm } from "./three-pl-rate-form";
import { SecurityForm } from "./security-form";
import { AlertCircle } from "lucide-react";

export const metadata = { title: "Company · Settings · PSP" };

export default async function CompanySettingsPage() {
  const user = await requireUser();

  // Page-level RBAC gate. Member has `company.view`; users without
  // that get bounced back to their profile (consistent with how the
  // sidebar nav hides this section for them).
  if (!hasPermission(user, "company.view")) {
    redirect("/settings/profile");
  }

  const company = await getCompany();
  const canEdit = hasPermission(user, "company.edit");

  if (!company) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/[0.02] px-4 py-10 text-center">
        <AlertCircle className="mx-auto size-8 text-destructive" />
        <p className="mt-2 text-sm font-medium text-destructive">
          Couldn&apos;t load company settings
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Try refreshing. If it keeps failing, sign out and back in.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <CompanyIdentityForm company={company} canEdit={canEdit} />
      <CompanyLocaleForm company={company} canEdit={canEdit} />
      <WorkingHoursForm company={company} canEdit={canEdit} />
      <HolidaysForm company={company} canEdit={canEdit} />
      <WarehousePickupForm company={company} canEdit={canEdit} />
      <ThreePlRateForm company={company} canEdit={canEdit} />
      <CurrencyRatesForm company={company} canEdit={canEdit} />
      <AllowedIpsForm company={company} canEdit={canEdit} />
      <NumberingFormatsForm company={company} canEdit={canEdit} />
      {user.is_admin && (
        <SecurityForm company={company} canEdit={canEdit} />
      )}
    </div>
  );
}
