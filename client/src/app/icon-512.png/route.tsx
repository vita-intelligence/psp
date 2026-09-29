import { ImageResponse } from "next/og";

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
          fontSize: 232,
          fontWeight: 700,
          letterSpacing: -10,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        PSP
      </div>
    ),
    { width: 512, height: 512 },
  );
}
