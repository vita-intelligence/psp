import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function WarehousesLoading() {
  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="space-y-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Toolbar (search + filters + columns + actions) */}
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 flex-1 max-w-xs rounded-md" />
          <Skeleton className="h-9 w-24 rounded-md" />
          <Skeleton className="h-9 w-24 rounded-md" />
          <div className="ml-auto">
            <Skeleton className="h-9 w-32 rounded-md" />
          </div>
        </div>
        {/* Table silhouette */}
        <div className="overflow-hidden rounded-lg border border-border/60">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="grid grid-cols-[1fr_8rem_2fr_7rem] items-center gap-3 border-b border-border/60 px-4 py-3 last:border-b-0"
            >
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-56" />
              <Skeleton className="h-5 w-16 rounded-md" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
