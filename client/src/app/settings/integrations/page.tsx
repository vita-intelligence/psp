import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listIntegrationTokens } from "@/lib/integrations/server";
import { IntegrationsClient } from "./integrations-client";
import type { IntegrationScope } from "@/lib/integrations/types";

export const metadata = { title: "Integrations · Settings · PSP" };

// Fallback known-scopes list mirrors the Elixir @known_scopes
// module attribute on `Backend.Accounts.IntegrationToken`. Used only
// when the server fetch fails so the mint dialog can still render.
const FALLBACK_SCOPES: IntegrationScope[] = [
  "mo:read",
  "mo:write:session",
  "mo:transition",
  "workstation:read",
  "item:read",
  "user:read",
  "hr:read",
  "hr:write:pin",
  "hr:write:reputation",
];

export default async function IntegrationsPage() {
  const user = await requireUser();
  if (!hasPermission(user, "integrations.manage")) {
    redirect("/settings/profile");
  }

  const initial = await listIntegrationTokens();

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="min-w-0 space-y-1.5">
          <CardTitle>Integrations</CardTitle>
          <CardDescription>
            Bearer tokens for machine-to-machine access to PSP. Each token
            is scoped to specific capabilities (list a token to see them).
            Rotate a token by minting a new one, updating the consumer,
            then revoking the old one — tokens can't be edited in place.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <IntegrationsClient
          initialTokens={initial?.items ?? []}
          knownScopes={initial?.known_scopes ?? FALLBACK_SCOPES}
        />
      </CardContent>
    </Card>
  );
}
