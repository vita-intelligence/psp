import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/brand/wordmark";
import { AlertTriangle } from "lucide-react";

export const metadata = { title: "Confirmation failed · PSP" };

interface PageProps {
  searchParams: Promise<{ reason?: string }>;
}

const MESSAGES: Record<string, string> = {
  missing: "This confirmation link is missing its token.",
  invalid: "This confirmation link is invalid or has already been used.",
  server_error: "Something went wrong on our end. Please try again.",
};

export default async function ConfirmFailedPage({ searchParams }: PageProps) {
  const { reason } = await searchParams;
  const message =
    (reason && MESSAGES[reason]) || "We couldn't confirm your email.";

  return (
    <div className="relative flex flex-1 flex-col">
      <BackgroundPattern />

      <header className="relative px-4 pt-6 sm:px-8 sm:pt-8">
        <Wordmark />
      </header>

      <main className="relative flex flex-1 items-center justify-center px-4 py-12 sm:py-20">
        <Card className="w-full max-w-sm border-border/60 shadow-lg shadow-foreground/[0.03]">
          <CardContent className="p-7 text-center space-y-4">
            <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="size-7 text-destructive" />
            </div>
            <div className="space-y-1.5">
              <h1 className="text-lg font-semibold">Confirmation failed</h1>
              <p className="text-sm text-muted-foreground">{message}</p>
            </div>
            <Button asChild className="h-11 w-full">
              <Link href="/login">Go to sign-in</Link>
            </Button>
          </CardContent>
        </Card>
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
