import { Skeleton } from "@/components/ui/skeleton";
import { Wordmark } from "@/components/brand/wordmark";

/**
 * Mirrors `TopBar`'s grouped layout: connection pill, divider, user
 * chip (avatar + name/email), sign-out icon button. Keeps the bar
 * silhouette identical so there's no layout shift on hydration.
 */
export function TopBarSkeleton() {
  return (
    <header className="sticky top-0 z-10 border-b border-border/60 bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-8">
        <Wordmark />

        <div className="flex items-center gap-2 sm:gap-3">
          <Skeleton className="h-7 w-7 rounded-full sm:w-20" />
          <span
            aria-hidden
            className="hidden h-6 w-px bg-border/80 sm:block"
          />
          <div className="flex items-center gap-2.5 py-1 pl-1 pr-2.5 sm:gap-3 sm:pr-3">
            <Skeleton className="size-8 rounded-full sm:size-9" />
            <div className="hidden space-y-1.5 sm:block">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-3 w-40" />
            </div>
          </div>
          <Skeleton className="size-9 rounded-md" />
        </div>
      </div>
    </header>
  );
}
