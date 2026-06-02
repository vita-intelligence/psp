import { TopBarSkeleton } from "@/components/layout/top-bar-skeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function SettingsLoading() {
  return (
    <div className="flex flex-1 flex-col">
      <TopBarSkeleton />
      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-2xl space-y-8">
          <header className="space-y-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-9 w-40 sm:h-10" />
            <Skeleton className="h-4 w-72" />
          </header>

          {[1, 2].map((i) => (
            <Card key={i} className="border-border/60">
              <CardHeader className="space-y-2">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-72 max-w-full" />
              </CardHeader>
              <CardContent className="space-y-4">
                <Skeleton className="h-11 w-full" />
                <Skeleton className="h-11 w-full" />
                <div className="flex justify-end">
                  <Skeleton className="h-10 w-32" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}
