import { AuthShellSkeleton } from "@/components/layout/auth-shell-skeleton";

export default function RegisterLoading() {
  // Three rows = name + email + password
  return <AuthShellSkeleton rows={3} />;
}
