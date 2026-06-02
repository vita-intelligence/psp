import { requireUser } from "@/lib/auth/server";
import { ProfileForm } from "./profile-form";
import { PasswordForm } from "./password-form";

export const metadata = { title: "Profile · Settings · PSP" };

export default async function ProfileSettingsPage() {
  const user = await requireUser();

  return (
    <div className="space-y-6">
      <ProfileForm
        initialName={user.name}
        initialAvatar={user.avatar ?? null}
        email={user.email}
      />
      <PasswordForm />
    </div>
  );
}
