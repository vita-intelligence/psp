import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Mirrors the real `UsersBoard` shape so the layout doesn't jump when
 * the data arrives. Two cards side-by-side at `md:`, stacked on mobile.
 */
export function UsersBoardSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="grid gap-4 sm:gap-5 md:grid-cols-2">
      <SectionSkeleton rows={rows} />
      <SectionSkeleton rows={rows} />
    </div>
  );
}

function SectionSkeleton({ rows }: { rows: number }) {
  return (
    <Card className="border-border/60 overflow-hidden">
      <CardContent className="p-0">
        <header className="flex items-center justify-between border-b border-border/60 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Skeleton className="size-4 rounded" />
            <Skeleton className="h-4 w-16" />
          </div>
          <Skeleton className="h-5 w-8 rounded-full" />
        </header>

        <ul>
          {Array.from({ length: rows }).map((_, i) => (
            <li
              key={i}
              className="flex items-center gap-3 px-5 py-3"
            >
              <Skeleton className="size-10 rounded-full" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3 w-44" />
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
