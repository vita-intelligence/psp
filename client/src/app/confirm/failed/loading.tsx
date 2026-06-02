import { AuthShellSkeleton } from "@/components/layout/auth-shell-skeleton";

export default function ConfirmFailedLoading() {
  // Minimal — the real page is an icon + heading + button.
  return <AuthShellSkeleton rows={0} />;
}
