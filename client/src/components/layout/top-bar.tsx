import Link from "next/link";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/lib/auth/actions";
import { Wordmark } from "@/components/brand/wordmark";
import { ConnectionPill } from "@/components/realtime/connection-pill";
import { UserAvatar } from "@/components/users/user-avatar";
import { LogOut } from "lucide-react";
import type { User } from "@/lib/types";

export function TopBar({ user }: { user: User }) {
  return (
    <header className="sticky top-0 z-10 border-b border-border/60 bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-8">
        <Wordmark />

        <div className="flex items-center gap-2 sm:gap-3">
          <ConnectionPill />

          <span
            aria-hidden
            className="hidden h-6 w-px bg-border/80 sm:block"
          />

          <Link
            href="/settings"
            className="flex items-center gap-2.5 rounded-lg py-1 pl-1 pr-2.5 transition-colors hover:bg-muted/50 focus-visible:bg-muted/60 focus-visible:outline-hidden sm:gap-3 sm:pr-3"
            title="Account settings"
            aria-label="Account settings"
          >
            <UserAvatar
              name={user.name}
              email={user.email}
              avatar={user.avatar}
              sizeClassName="size-8 sm:size-9"
            />
            <div className="hidden text-left leading-tight sm:block">
              <p className="text-sm font-medium">{user.name}</p>
              <p className="text-xs text-muted-foreground">{user.email}</p>
            </div>
          </Link>

          <form action={logoutAction}>
            <Button
              variant="ghost"
              size="icon"
              type="submit"
              className="size-9 text-muted-foreground hover:text-foreground"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut className="size-4" />
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
