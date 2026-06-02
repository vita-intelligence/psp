import { redirect } from "next/navigation";

// Bare /settings always lands the user on Profile — keeps the URL bar
// reflecting which section is open.
export default function SettingsRoot() {
  redirect("/settings/profile");
}
