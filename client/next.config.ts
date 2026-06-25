import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfkit ships its standard-font `.afm` files as data assets that
  // Turbopack mis-bundles (it looks for them under `/ROOT/node_modules/…`
  // at runtime). Marking the package external keeps it loading
  // straight from node_modules so its data-file lookups resolve.
  serverExternalPackages: ["pdfkit"],

  // Dev-only: allow the laptop's LAN IP so phones / tablets on the
  // same Wi-Fi can hit `http://<lan-ip>:3010` for QR pairing without
  // tripping Next 15+'s cross-origin protections (HMR + server-action
  // Origin check). Production goes through a proper hostname so this
  // is not needed there. Port is 3010 (not 3000) so PSP coexists with
  // other Next dev servers on the laptop without dual-bind clashes.
  allowedDevOrigins: [
    "192.168.0.116",
    "192.168.0.0/24",
    "maksyms-macbook-pro.local",
  ],
  experimental: {
    serverActions: {
      // Multipart image uploads (item gallery) flow through server
      // actions. Default cap is 1 MB; bump to match the backend's
      // per-image limit so users see the proper "file too large" error
      // from the API rather than a confusing Next.js render crash.
      bodySizeLimit: "6mb",
      // Server actions verify Origin matches the host. Phones land on
      // the LAN URL, so list both the .local hostname (preferred —
      // Safari persists cookies for it) and the raw IP fallback.
      allowedOrigins: [
        "maksyms-macbook-pro.local:3010",
        "192.168.0.116:3010",
        "localhost:3010",
      ],
    },
  },
};

export default nextConfig;
