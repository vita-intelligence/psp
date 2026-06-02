import Link from "next/link";
import { Wordmark } from "@/components/brand/wordmark";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · PSP" };

export default function LoginPage() {
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
              Welcome back
            </h1>
            <p className="text-sm text-muted-foreground">
              Sign in to your Vita PSP account
            </p>
          </div>

          <LoginForm />

          <p className="text-center text-sm text-muted-foreground">
            New here?{" "}
            <Link
              href="/register"
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              Create an account
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
