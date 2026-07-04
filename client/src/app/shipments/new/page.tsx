import { redirect } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ChevronLeft, Truck } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { createShipmentServer } from "@/lib/shipments/server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/forms/error-banner";

export const metadata = { title: "New shipment · PSP" };
export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ lot_uuid?: string }>;
}

export default async function NewShipmentPage({ searchParams }: Props) {
  const user = await requireUser();
  if (!hasPermission(user, "shipments.edit")) {
    redirect("/settings/profile");
  }

  const { lot_uuid } = await searchParams;

  // Happy path: the wizard passes ?lot_uuid=... — create the draft
  // and jump straight into the desktop edit form. Uses the
  // render-safe helper (createShipmentAction calls revalidatePath,
  // which Next 16 disallows from inside a page render).
  if (lot_uuid && typeof lot_uuid === "string") {
    const res = await createShipmentServer(lot_uuid);
    if (res.ok) {
      redirect(`/shipments/${res.shipment.uuid}`);
    }

    return (
      <div className="flex flex-1 flex-col">
        <TopBar user={user} />
        <PresenceMount />
        <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
          <div className="mx-auto max-w-xl space-y-4">
            <BackLink />
            <ErrorBanner detail={res.detail} code={res.code} />
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <AlertTriangle className="size-4 text-amber-600" />
                  Couldn&apos;t start this shipment
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="text-muted-foreground">
                  Common reasons: the lot isn&apos;t sitting in a dispatch
                  cell yet, or a shipment is already open on it. Head back to
                  the order wizard to see where the lot is.
                </p>
                <Button asChild variant="outline">
                  <Link href="/shipments">Back to shipments</Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
    );
  }

  // No lot passed → surface the hint. The primary entry point is the
  // customer-order wizard CTA; the item-in-dispatch selector can come
  // later if a real workflow needs it.
  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-xl space-y-6">
          <BackLink />

          <header className="space-y-1.5">
            <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight sm:text-3xl">
              <Truck className="size-6 text-brand sm:size-7" />
              New shipment
            </h1>
            <p className="text-sm text-muted-foreground">
              Shipments start from the customer-order wizard&apos;s{" "}
              <span className="whitespace-nowrap">
                &ldquo;Create shipment&rdquo;
              </span>{" "}
              CTA — that&apos;s the moment we know exactly which lot needs
              paperwork.
            </p>
          </header>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Start from the project</CardTitle>
              <CardDescription>
                Open the order that&apos;s in the &ldquo;Paperwork&rdquo;
                phase and tap Create shipment. That path links the shipment
                to the right lot automatically.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <Link href="/projects">Open projects</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}

function BackLink() {
  return (
    <div className="text-sm">
      <Link
        href="/shipments"
        className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        Shipments
      </Link>
    </div>
  );
}
