import Link from "next/link";
import { lookupPairingCode } from "@/lib/devices/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Wordmark } from "@/components/brand/wordmark";
import { ClaimForm } from "./claim-form";

export const metadata = { title: "Pair this device · PSP" };

interface Props {
  searchParams: Promise<{ code?: string; error?: string }>;
}

export default async function PairPage({ searchParams }: Props) {
  const { code, error } = await searchParams;
  const trimmed = (code ?? "").trim().toUpperCase();
  const valid = trimmed ? await lookupPairingCode(trimmed) : null;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="px-4 pt-6 sm:px-8 sm:pt-8">
        <Wordmark />
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-6">
        <Card className="w-full max-w-sm border-border/60">
          <CardHeader>
            <CardTitle>Pair this device</CardTitle>
            <CardDescription>
              {trimmed
                ? "Confirm and name this device. Once paired, it can receive scan actions sent from your laptop."
                : "Enter the 6-character code shown on your laptop's pairing screen."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            {trimmed && !valid && !error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                This code is invalid, expired, or already used. Generate
                a new one from{" "}
                <Link
                  href="/login"
                  className="font-medium underline underline-offset-2"
                >
                  your laptop
                </Link>
                .
              </div>
            )}

            <ClaimForm initialCode={trimmed} hasValidPrefill={Boolean(valid)} />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
