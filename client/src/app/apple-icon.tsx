import { ImageResponse } from "next/og";

// iOS home-screen icon. Safari picks this up via <link
// rel="apple-touch-icon"> and applies a rounded-corner mask itself,
// so we ship a flat square and let the OS handle the corner radius.
// 180×180 is the current iOS spec (retina @3x for the standard 60pt
// icon).
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
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
          fontSize: 82,
          fontWeight: 700,
          letterSpacing: -4,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        PSP
      </div>
    ),
    size,
  );
}
