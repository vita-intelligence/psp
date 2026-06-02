import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { logoutAction } from "@/lib/auth/actions";
import { initialsOf } from "@/lib/initials";
import { avatarColour } from "@/lib/avatar-color";
import { cn } from "@/lib/utils";
import { Wordmark } from "@/components/brand/wordmark";
import { ConnectionPill } from "@/components/realtime/connection-pill";
import { LogOut } from "lucide-react";
import type { User } from "@/lib/types";

export function TopBar({ user }: { user: User }) {
  const tint = avatarColour(user.email);

  return (
    <header className="sticky top-0 z-10 border-b border-border/60 bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-8">
        <Wordmark />

        <div className="flex items-center gap-2 sm:gap-3">
          <ConnectionPill />

          {/* Subtle divider — visually groups the user cluster apart
              from the status pill without adding a heavy border. */}
          <span
            aria-hidden
            className="hidden h-6 w-px bg-border/80 sm:block"
          />

          <UserChip user={user} tint={tint} />

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

function UserChip({
  user,
  tint,
}: {
  user: User;
  tint: { bg: string; text: string };
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg py-1 pl-1 pr-2.5 sm:gap-3 sm:pr-3 sm:hover:bg-muted/50">
      <Avatar className="size-8 sm:size-9">
        <AvatarFallback
          className={cn("text-xs font-semibold sm:text-sm", tint.bg, tint.text)}
        >
          {initialsOf(user.name)}
        </AvatarFallback>
      </Avatar>
      <div className="hidden text-left leading-tight sm:block">
        <p className="text-sm font-medium">{user.name}</p>
        <p className="text-xs text-muted-foreground">{user.email}</p>
      </div>
    </div>
  );
}
