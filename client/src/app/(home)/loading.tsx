import { TopBarSkeleton } from "@/components/layout/top-bar-skeleton";
import { UsersBoardSkeleton } from "@/components/users/users-board-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Streamed by Next.js while the home server component awaits
 * `requireUser()` + the layout shell renders. Matches the real page's
 * silhouette so there's no layout shift when the data arrives.
 */
export default function HomeLoading() {
  return (
    <div className="flex flex-1 flex-col">
      <TopBarSkeleton />
      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-6xl space-y-8">
          <header className="space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-9 w-44 sm:h-10" />
            <Skeleton className="h-4 w-full max-w-md" />
          </header>
          <UsersBoardSkeleton />
        </div>
      </main>
    </div>
  );
}
