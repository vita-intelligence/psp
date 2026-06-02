import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { logoutAction } from "@/lib/auth/actions";
import { initialsOf } from "@/lib/initials";
import { avatarColour } from "@/lib/avatar-color";
import { cn } from "@/lib/utils";
import { Wordmark } from "@/components/brand/wordmark";
import { LogOut } from "lucide-react";
import type { User } from "@/lib/types";

export function TopBar({ user }: { user: User }) {
  const tint = avatarColour(user.email);

  return (
    <header className="sticky top-0 z-10 border-b border-border/60 bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-8">
        <Wordmark />

        <div className="flex items-center gap-2 sm:gap-3">
          <div className="hidden text-right leading-tight sm:block">
            <p className="text-sm font-medium">{user.name}</p>
            <p className="text-xs text-muted-foreground">{user.email}</p>
          </div>
          <Avatar className="size-9 ring-2 ring-background">
            <AvatarFallback
              className={cn(
                "text-sm font-semibold",
                tint.bg,
                tint.text,
              )}
            >
              {initialsOf(user.name)}
            </AvatarFallback>
          </Avatar>
          <form action={logoutAction}>
            <Button
              variant="ghost"
              size="sm"
              type="submit"
              className="text-muted-foreground hover:text-foreground"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut className="size-4" />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
