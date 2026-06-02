import { Wordmark } from "@/components/brand/wordmark";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface AuthShellSkeletonProps {
  /** Number of stacked form-row skeletons inside the card. */
  rows?: number;
}

/**
 * Matches the auth-page shell (login / register / confirm-failed):
 * wordmark in the top-left, soft brand halo in the background,
 * card centered vertically. Use as the `loading.tsx` body so the
 * navigation flash from a server-component round-trip lands on the
 * same silhouette the real page will paint.
 */
export function AuthShellSkeleton({ rows = 2 }: AuthShellSkeletonProps) {
  return (
    <div className="relative flex flex-1 flex-col">
      <BackgroundPattern />

      <header className="relative px-4 pt-6 sm:px-8 sm:pt-8">
        <Wordmark />
      </header>

      <main className="relative flex flex-1 items-center justify-center px-4 py-12 sm:py-20">
        <div className="w-full max-w-sm space-y-8">
          <div className="space-y-2 text-center">
            <Skeleton className="mx-auto h-8 w-48 sm:h-9" />
            <Skeleton className="mx-auto h-4 w-64" />
          </div>

          <Card className="border-border/60 shadow-lg shadow-foreground/[0.03]">
            <CardContent className="p-6 sm:p-7 space-y-5">
              {Array.from({ length: rows }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-11 w-full" />
                </div>
              ))}
              <Skeleton className="h-11 w-full" />
            </CardContent>
          </Card>

          <Skeleton className="mx-auto h-4 w-40" />
        </div>
      </main>
    </div>
  );
}

function BackgroundPattern() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
    >
      <div className="absolute -top-40 left-1/2 size-[600px] -translate-x-1/2 rounded-full bg-brand/10 blur-3xl" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0,var(--background)_70%)]" />
    </div>
  );
}
