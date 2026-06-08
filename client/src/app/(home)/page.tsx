import { requireUser } from "@/lib/auth/server";
import { TopBar } from "@/components/layout/top-bar";
import { UsersBoard } from "@/components/users/users-board";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { ModuleGrid } from "./module-grid";

export default async function HomePage() {
  const user = await requireUser();
  const firstName = user.name.split(" ")[0] ?? user.name;
  const greeting = greetingFor(new Date());

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-6xl space-y-10">
          <header className="space-y-1.5">
            <p className="text-sm font-medium text-brand">{greeting}</p>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Hi {firstName}
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
              Jump into a module, or check who&apos;s around right now.
            </p>
          </header>

          <ModuleGrid user={user} />

          <section className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Who&apos;s around
            </h2>
            <UsersBoard currentUserId={user.id} />
          </section>
        </div>
      </main>
    </div>
  );
}

function greetingFor(date: Date): string {
  const hour = date.getHours();
  if (hour < 5) return "Late night";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
