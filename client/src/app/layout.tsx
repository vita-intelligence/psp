import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { QueryProvider } from "@/lib/query-client";
import { Toaster } from "@/components/ui/sonner";
import { CompanyPrefsProvider } from "@/lib/format/company-prefs-context";
import { PrintBridgeListener } from "@/components/realtime/print-bridge-listener";
import { getCompanyDefaults } from "@/lib/company/server";
import { getCurrentUser } from "@/lib/auth/server";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PSP — Procurement, Stock, Production",
  description: "Vita Manufacture's production operations workspace.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Hydrate company locale defaults into a context so every client
  // component (audit tables, lots list, devices panel, …) can format
  // dates / numbers / money against the same source of truth without
  // prop drilling. Empty object when unauthed — the helpers fall back
  // to ISO + dot-decimal in that case.
  //
  // `viewer` carries just the uuid for the print-bridge listener — null
  // on unauthed pages so the WS subscription stays dormant.
  const [defaults, viewer] = await Promise.all([
    getCompanyDefaults().catch(() => null),
    getCurrentUser().catch(() => null),
  ]);

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body
        className="min-h-full bg-background text-foreground flex flex-col"
        suppressHydrationWarning
      >
        <CompanyPrefsProvider prefs={defaults ?? {}}>
          <QueryProvider>{children}</QueryProvider>
        </CompanyPrefsProvider>
        <PrintBridgeListener
          viewer={viewer ? { uuid: viewer.uuid } : null}
        />
        <Toaster richColors closeButton position="bottom-right" />
      </body>
    </html>
  );
}
