import { ImageResponse } from "next/og";

// Maskable variant — Android launchers crop icons to platform shapes
// (circle on Pixel, squircle on Samsung, etc.). Content must sit
// inside the inner ~80% safe zone or the launcher will chop off the
// monogram. We fill the full canvas with brand colour and shrink the
// text so nothing important gets clipped.
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
          fontSize: 168,
          fontWeight: 700,
          letterSpacing: -8,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        PSP
      </div>
    ),
    { width: 512, height: 512 },
  );
}
