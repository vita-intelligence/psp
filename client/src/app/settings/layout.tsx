import { requireUser } from "@/lib/auth/server";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { SettingsNav } from "./settings-nav";

export const metadata = { title: "Settings · PSP" };

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />

      <div className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-6xl space-y-6">
          <header className="space-y-1.5">
            <p className="text-sm font-medium text-brand">Account</p>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Settings
            </h1>
            <p className="text-sm text-muted-foreground sm:text-base">
              Manage your profile, security, and company-wide settings.
            </p>
          </header>

          <div className="grid gap-6 md:grid-cols-[200px_minmax(0,1fr)]">
            <SettingsNav permissions={user.permissions ?? []} />
            <main className="min-w-0">{children}</main>
          </div>
        </div>
      </div>
    </div>
  );
}
