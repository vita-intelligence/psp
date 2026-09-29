import { ImageResponse } from "next/og";

// Rendered at build time so the standalone Docker image ships a
// static PNG rather than paying the OG-cost on every install.
export const dynamic = "force-static";

export function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0f172a",
          color: "#ffffff",
          fontSize: 88,
          fontWeight: 700,
          letterSpacing: -4,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        PSP
      </div>
    ),
    { width: 192, height: 192 },
  );
}
