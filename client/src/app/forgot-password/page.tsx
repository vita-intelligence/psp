import Link from "next/link";
import { Wordmark } from "@/components/brand/wordmark";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata = { title: "Forgot password · PSP" };

export default function ForgotPasswordPage() {
  return (
    <div className="relative flex flex-1 flex-col">
      <BackgroundPattern />

      <header className="relative px-4 pt-6 sm:px-8 sm:pt-8">
        <Wordmark />
      </header>

      <main className="relative flex flex-1 items-center justify-center px-4 py-12 sm:py-20">
        <div className="w-full max-w-sm space-y-8">
          <div className="space-y-2 text-center">
            <h1 className="text-3xl font-semibold tracking-tight">
              Reset your password
            </h1>
            <p className="text-sm text-muted-foreground">
              We'll email you a link to choose a new one.
            </p>
          </div>

          <ForgotPasswordForm />

          <p className="text-center text-sm text-muted-foreground">
            Remembered it?{" "}
            <Link
              href="/login"
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              Back to sign in
            </Link>
          </p>
        </div>
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
