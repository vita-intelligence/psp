import Link from "next/link";
import { Wordmark } from "@/components/brand/wordmark";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Compass } from "lucide-react";

export const metadata = { title: "Not found · PSP" };

export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="px-4 pt-6 sm:px-8 sm:pt-8">
        <Wordmark />
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-12 sm:py-20">
        <Card className="w-full max-w-md border-border/60 shadow-lg shadow-foreground/[0.03]">
          <CardContent className="p-7 text-center space-y-4">
            <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-brand/10">
              <Compass className="size-7 text-brand" />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                404
              </p>
              <h1 className="text-lg font-semibold">Page not found</h1>
              <p className="text-sm text-muted-foreground">
                The page you're looking for isn't here. It may have been
                moved, or the link might be wrong.
              </p>
            </div>
            <Button asChild className="h-11 w-full">
              <Link href="/">Back to home</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
