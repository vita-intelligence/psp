import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function WarehouseEditLoading() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-8 w-20" />
      </div>
      <Card className="border-border/60">
        <CardHeader className="space-y-2">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </CardHeader>
        <CardContent className="space-y-4">
          {[1, 2, 3, 4, 5].map((j) => (
            <div
              key={j}
              className="grid gap-2 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4"
            >
              <Skeleton className="h-4 w-24 sm:mt-2" />
              <Skeleton className="h-11 w-full" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
