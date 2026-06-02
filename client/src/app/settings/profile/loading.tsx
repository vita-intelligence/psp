import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

/**
 * Skeleton ONLY for the inner /settings/profile pane — the layout
 * (top bar + sidebar nav) is already rendered by /settings/layout.tsx
 * and stays put during section navigation.
 */
export default function ProfileLoading() {
  return (
    <div className="space-y-6">
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
  );
}
