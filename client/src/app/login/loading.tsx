import { AuthShellSkeleton } from "@/components/layout/auth-shell-skeleton";

export default function LoginLoading() {
  // Two rows = email + password
  return <AuthShellSkeleton rows={2} />;
}
