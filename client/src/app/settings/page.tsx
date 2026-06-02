import { requireUser } from "@/lib/auth/server";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { ProfileForm } from "./profile-form";
import { PasswordForm } from "./password-form";

export const metadata = { title: "Settings · PSP" };

export default async function SettingsPage() {
  const user = await requireUser();

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-2xl space-y-8">
          <header className="space-y-1.5">
            <p className="text-sm font-medium text-brand">Account</p>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Settings
            </h1>
            <p className="text-sm text-muted-foreground sm:text-base">
              Update your profile and security details.
            </p>
          </header>

          <ProfileForm
            initialName={user.name}
            initialAvatar={user.avatar ?? null}
            email={user.email}
          />

          <PasswordForm />
        </div>
      </main>
    </div>
  );
}
