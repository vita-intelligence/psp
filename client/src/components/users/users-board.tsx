"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { usePresence } from "@/lib/realtime/presence-store";
import { cn } from "@/lib/utils";
import { messageFor } from "@/lib/errors/codes";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UsersBoardSkeleton } from "./users-board-skeleton";
import { UserAvatar } from "./user-avatar";
import { AlertCircle, RefreshCw, Users, UserCheck, UserX } from "lucide-react";
import type { TeamMember } from "@/lib/types";

interface UsersErrorBody {
  error?: string;
  detail?: string;
}

async function fetchTeam(): Promise<TeamMember[]> {
  // The home roster uses the slim `/api/team` payload (id/name/email/
  // avatar/online) so it works regardless of `users.view` — that
  // permission gates the admin Users settings page, not "who's
  // here". Single-shot flat read; pagination lives on /api/users.
  const res = await fetch("/api/team", { cache: "no-store" });
  if (!res.ok) {
    let body: UsersErrorBody = {};
    try {
      body = (await res.json()) as UsersErrorBody;
    } catch {
      // body wasn't JSON
    }
    const err = new Error(messageFor(body.error, body.detail));
    (err as Error & { code?: string }).code = body.error;
    throw err;
  }
  const data = (await res.json()) as { items: TeamMember[] };
  return data.items;
}

export function UsersBoard({ currentUserId }: { currentUserId: number }) {
  const presenceMap = usePresence((s) => s.byUserId);
  const onlineSet = useMemo(
    () => new Set(Object.keys(presenceMap)),
    [presenceMap],
  );

  const usersQuery = useQuery({
    queryKey: ["team"],
    queryFn: fetchTeam,
  });

  if (usersQuery.isLoading) {
    return <UsersBoardSkeleton />;
  }

  if (usersQuery.error || !usersQuery.data) {
    const message =
      usersQuery.error instanceof Error
        ? usersQuery.error.message
        : "Couldn't load the team roster.";
    return (
      <Card className="border-destructive/30 bg-destructive/[0.02]">
        <CardContent className="space-y-3 py-10 text-center">
          <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-destructive/10">
            <AlertCircle className="size-5 text-destructive" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-destructive">
              Couldn't load the team
            </p>
            <p className="text-xs text-muted-foreground">{message}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => usersQuery.refetch()}
            disabled={usersQuery.isFetching}
          >
            <RefreshCw
              className={cn(
                "mr-1.5 size-3.5",
                usersQuery.isFetching && "animate-spin",
              )}
            />
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  }

  const users = usersQuery.data.map((u) => ({
    ...u,
    is_online: onlineSet.has(String(u.id)) || u.is_online,
  }));
  const online = users.filter((u) => u.is_online);
  const offline = users.filter((u) => !u.is_online);

  if (users.length === 0) {
    return (
      <Card className="border-border/60 border-dashed">
        <CardContent className="py-16 text-center space-y-2">
          <Users className="mx-auto size-8 text-muted-foreground" />
          <p className="text-sm font-medium">You're the only one here</p>
          <p className="text-xs text-muted-foreground">
            Invite your teammates to join PSP.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 sm:gap-5 md:grid-cols-2">
      <Section
        title="Online"
        count={online.length}
        users={online}
        currentUserId={currentUserId}
        icon={UserCheck}
        accent="brand"
        empty="No one else is online right now."
      />
      <Section
        title="Offline"
        count={offline.length}
        users={offline}
        currentUserId={currentUserId}
        icon={UserX}
        accent="muted"
        empty="Everyone is online — nice."
      />
    </div>
  );
}

interface SectionProps {
  title: string;
  count: number;
  users: TeamMember[];
  currentUserId: number;
  icon: typeof UserCheck;
  accent: "brand" | "muted";
  empty: string;
}

function Section({
  title,
  count,
  users,
  currentUserId,
  icon: Icon,
  accent,
  empty,
}: SectionProps) {
  return (
    <Card className="border-border/60 overflow-hidden">
      <CardContent className="p-0">
        <header className="flex items-center justify-between border-b border-border/60 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Icon
              className={cn(
                "size-4",
                accent === "brand" ? "text-brand" : "text-muted-foreground",
              )}
            />
            <h2 className="text-sm font-semibold">{title}</h2>
          </div>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-medium tabular-nums",
              accent === "brand"
                ? "bg-brand/10 text-brand"
                : "bg-muted text-muted-foreground",
            )}
          >
            {count}
          </span>
        </header>

        {users.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {empty}
          </p>
        ) : (
          <ul>
            {users.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                isYou={u.id === currentUserId}
                online={accent === "brand"}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function UserRow({
  user,
  isYou,
  online,
}: {
  user: TeamMember;
  isYou: boolean;
  online: boolean;
}) {
  return (
    <li className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/40">
      <div className="relative shrink-0">
        <UserAvatar
          name={user.name}
          email={user.email}
          avatar={user.avatar}
          sizeClassName="size-10"
        />
        {online ? (
          <span
            aria-label="online"
            className="absolute -bottom-0.5 -right-0.5 flex size-3 items-center justify-center"
          >
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex size-3 rounded-full border-2 border-background bg-emerald-500" />
          </span>
        ) : (
          <span
            aria-label="offline"
            className="absolute -bottom-0.5 -right-0.5 inline-flex size-3 rounded-full border-2 border-background bg-zinc-300"
          />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-sm font-medium">
          {user.name}
          {isYou && (
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              You
            </span>
          )}
        </p>
        <p className="truncate text-xs text-muted-foreground">{user.email}</p>
      </div>
    </li>
  );
}
