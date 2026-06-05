import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Multipart image uploads (item gallery) flow through server
      // actions. Default cap is 1 MB; bump to match the backend's
      // per-image limit so users see the proper "file too large" error
      // from the API rather than a confusing Next.js render crash.
      bodySizeLimit: "6mb",
    },
  },
};

export default nextConfig;
