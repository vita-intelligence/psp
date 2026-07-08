import { requireUser } from "@/lib/auth/server";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { HRSubnav } from "./hr-subnav";

export const metadata = { title: "HR · PSP" };

/**
 * HR module shell — TopBar + presence beacon + sticky HRSubnav.
 * Every /hr/* page inherits this so the subnav follows the operator
 * across Overview / Employees / Wages / Reputation / Shifts. Same
 * pattern the Procurement + Stock modules use.
 */
export default async function HRLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const user = await requireUser();

    return (
        <div className="flex flex-1 flex-col">
            <TopBar user={user} />
            <PresenceMount />
            <HRSubnav />
            <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
                <div className="mx-auto max-w-6xl space-y-6">{children}</div>
            </main>
        </div>
    );
}
