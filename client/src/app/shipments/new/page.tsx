import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Truck } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { NewShipmentShell } from "./new-shell";
import { createShipmentAction } from "@/lib/shipments/actions";

export const metadata = { title: "New shipment · PSP" };
export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ lot_uuid?: string }>;
}

export default async function NewShipmentPage({ searchParams }: Props) {
  const user = await requireUser();
  if (!hasPermission(user, "production.final_release")) {
    redirect("/settings/profile");
  }

  const { lot_uuid } = await searchParams;

  // Shortcut: wizard CTA passes ?lot_uuid=... — create the draft
  // immediately and jump straight to the edit page. The scan surface
  // then only fires for the "operator entered /shipments/new on
  // their own" path.
  if (lot_uuid && typeof lot_uuid === "string") {
    const res = await createShipmentAction(lot_uuid);
    if (res.ok) {
      redirect(`/shipments/${res.shipment.uuid}`);
    }
    // Fall through to the scan page with an error banner if creation
    // failed (lot moved, already shipped, etc.).
    return (
      <NewShipmentShell
        initialError={{
          code: res.code,
          detail: res.detail,
        }}
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-2xl space-y-6">
          <div className="text-sm">
            <Link
              href="/shipments"
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="size-4" />
              Shipments
            </Link>
          </div>

          <header className="space-y-1.5">
            <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight sm:text-3xl">
              <Truck className="size-6 text-brand sm:size-7" />
              New shipment
            </h1>
            <p className="text-sm text-muted-foreground">
              Scan the lot QR code to link the goods to a new shipment
              record. If the label lives on the warehouse floor, push the
              scan task to a paired mobile device.
            </p>
          </header>

          <NewShipmentShell />
        </div>
      </main>
    </div>
  );
}
