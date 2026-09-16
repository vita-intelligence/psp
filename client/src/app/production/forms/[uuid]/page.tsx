import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, ClipboardCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge-mini";
import { Button } from "@/components/ui/button";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { requireUser } from "@/lib/auth/server";
import {
  getFormTemplate,
  listFormAudienceOptions,
  listFormTemplateAssignments,
} from "@/lib/forms/server";
import { TRIGGER_LABELS } from "@/lib/forms/types";
import { hasPermission } from "@/lib/rbac";
import { ProductionSubnav } from "../../production-subnav";
import { FormBuilder } from "../_components/form-builder";

interface PageProps {
  params: Promise<{ uuid: string }>;
}

export const metadata = {
  title: "Edit form · Forms · Production · PSP",
};

export const dynamic = "force-dynamic";

export default async function EditFormPage({ params }: PageProps) {
  const user = await requireUser();
  if (!hasPermission(user, "forms.view")) {
    redirect("/");
  }

  const { uuid } = await params;
  const [template, audienceOptions, assignments] = await Promise.all([
    getFormTemplate(uuid),
    listFormAudienceOptions(),
    listFormTemplateAssignments(uuid),
  ]);
  if (!template) notFound();

  const canEdit = hasPermission(user, "forms.act");

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <ProductionSubnav />

      <main className="flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-7xl space-y-6">
          <div>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
            >
              <Link href="/production/forms">
                <ChevronLeft className="mr-1 size-4" />
                Back to forms
              </Link>
            </Button>
          </div>

          <header className="space-y-1.5">
            <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight sm:text-3xl">
              <ClipboardCheck className="size-6 text-brand" />
              <span>{template.name}</span>
              {!template.is_active && <Badge tone="muted">Archived</Badge>}
            </h1>
            <p className="text-sm text-muted-foreground">
              {TRIGGER_LABELS[template.trigger]} · v{template.version}
            </p>
          </header>

          <FormBuilder
            template={template}
            canEdit={canEdit}
            audienceOptions={audienceOptions}
            assignments={assignments}
          />
        </div>
      </main>
    </div>
  );
}
