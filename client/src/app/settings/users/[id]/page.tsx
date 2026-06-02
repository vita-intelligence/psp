import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { getUser } from "@/lib/users/server";
import { getPermissionMatrix } from "@/lib/permissions/server";
import { hasPermission } from "@/lib/rbac";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge-mini";
import { UserAvatar } from "@/components/users/user-avatar";
import {
  ChevronLeft,
  Mail,
  ShieldCheck,
  Calendar,
  CircleDot,
} from "lucide-react";
import { UserAccessForm } from "./user-access-form";
import { AuditMetaSection } from "@/components/audit/audit-meta-section";
import { AuditHistoryCard } from "@/components/audit/audit-history-card";

interface PageProps {
  params: Promise<{ id: string }>;
}

export const metadata = { title: "User · Settings · PSP" };

export default async function UserAdminPage({ params }: PageProps) {
  const currentUser = await requireUser();
  if (!hasPermission(currentUser, "users.view")) {
    redirect("/settings/profile");
  }

  const { id } = await params;
  const [subject, availableMatrix] = await Promise.all([
    getUser(id),
    getPermissionMatrix(),
  ]);
  if (!subject) notFound();

  const canEditAccess = hasPermission(currentUser, "roles.edit");
  const canApplyTemplate = hasPermission(currentUser, "roles.view");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
        >
          <Link href="/settings/users">
            <ChevronLeft className="mr-1 size-4" />
            Back to users
          </Link>
        </Button>
        {/* Edit / Deactivate / Invite-reset actions land here once
            the users.invite + users.deactivate flows ship. */}
      </div>

      <Card className="border-border/60">
        <CardHeader>
          <div className="flex flex-wrap items-start gap-4 sm:flex-nowrap">
            <div className="relative shrink-0">
              <UserAvatar
                name={subject.name}
                email={subject.email}
                avatar={subject.avatar}
                sizeClassName="size-16"
                fallbackClassName="text-xl"
                className="ring-2 ring-border"
              />
              {subject.is_online && (
                <span
                  aria-label="Online"
                  className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-background bg-emerald-500"
                />
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <CardTitle className="break-words">{subject.name}</CardTitle>
              <CardDescription className="break-all">
                {subject.email}
              </CardDescription>
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <Badge tone={subject.is_active ? "emerald" : "muted"}>
                  {subject.is_active ? "Active" : "Inactive"}
                </Badge>
                {!subject.confirmed_at && (
                  <Badge tone="amber">Unconfirmed</Badge>
                )}
                {subject.is_admin && <Badge tone="brand">Admin</Badge>}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <DetailRow
              icon={Mail}
              label="Email"
              value={subject.email}
              mono
            />
            <DetailRow
              icon={CircleDot}
              label="Status"
              value={subject.is_active ? "Active" : "Inactive"}
            />
            <DetailRow
              icon={ShieldCheck}
              label="Access"
              value={
                subject.is_admin
                  ? "Admin (bypass)"
                  : `${(subject.permissions ?? []).length} permission${
                      (subject.permissions ?? []).length === 1 ? "" : "s"
                    }`
              }
            />
            <DetailRow
              icon={Calendar}
              label="Joined"
              value={new Date(subject.inserted_at).toLocaleDateString()}
            />
          </dl>
        </CardContent>
      </Card>

      <UserAccessForm
        subject={subject}
        matrix={availableMatrix}
        canEdit={canEditAccess}
        canApplyTemplate={canApplyTemplate}
      />

      {/* Departments tab arrives in the next slice. */}
      <PlaceholderCard
        title="Departments"
        description="Assign the user to a department. Departments table arrives in the next slice."
      />

      <AuditMetaSection
        inserted_at={subject.inserted_at}
        updated_at={subject.updated_at}
        created_by={subject.created_by}
        updated_by={subject.updated_by}
      />
      <AuditHistoryCard entityType="user" entityId={subject.id} />
    </div>
  );
}

function DetailRow({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon: typeof Mail;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <dt className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </dt>
        <dd
          className={
            "truncate text-sm " + (mono ? "font-mono text-xs" : "")
          }
        >
          {value}
        </dd>
      </div>
    </div>
  );
}

function PlaceholderCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Card className="border-border/60 border-dashed">
      <CardHeader>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle className="text-base">{title}</CardTitle>
          <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Coming soon
          </span>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
    </Card>
  );
}
