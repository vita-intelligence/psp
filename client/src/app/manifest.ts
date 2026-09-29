import type { MetadataRoute } from "next";

/**
 * Web App Manifest — makes PSP installable as a PWA on warehouse
 * phones and tablets. Chrome / Edge show an "Install app" prompt;
 * iOS Safari exposes "Add to Home Screen".
 *
 * `start_url: "/m"` lands the operator on the mobile tile grid
 * (`getDeviceDisplay` redirects to `/pair` if the phone hasn't been
 * paired yet, which is the same flow the browser uses today).
 *
 * `scope: "/"` keeps navigations inside the standalone window even
 * when the app hops to `/pair` or a full-screen photo view — without
 * this the browser chrome pops back the moment `/m/*` is left.
 *
 * Icons are generated on-demand by the sibling `icon-*.png` route
 * handlers (`next/og` at build time when possible, on-request in
 * dev). Swap in real brand PNGs by replacing those route handlers
 * with static files under `public/` and pointing the icon `src`
 * paths at them.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PSP — Warehouse & Production",
    short_name: "PSP",
    description:
      "Vita Manufacture's production operations workspace — scan-driven mobile flow for goods-in, pickup, closeout, and dispatch.",
    start_url: "/m",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0f172a",
    theme_color: "#0f172a",
    categories: ["productivity", "business"],
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
