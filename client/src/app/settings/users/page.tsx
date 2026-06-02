import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { listUsersFirstPage } from "@/lib/users/server";
import { hasPermission } from "@/lib/rbac";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { UsersTable } from "./users-table";

export const metadata = { title: "Users · Settings · PSP" };

export default async function UsersListPage() {
  const user = await requireUser();
  if (!hasPermission(user, "users.view")) {
    redirect("/settings/profile");
  }

  const initialPage = await listUsersFirstPage();

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <CardTitle>Users</CardTitle>
            <CardDescription>
              Everyone with access to this PSP workspace. Click a row to
              open their admin page.
            </CardDescription>
          </div>
          {/* Invite action will live here once the invite flow ships
              (requires the `users.invite` permission). */}
        </div>
      </CardHeader>
      <CardContent>
        <UsersTable initialPage={initialPage} />
      </CardContent>
    </Card>
  );
}
