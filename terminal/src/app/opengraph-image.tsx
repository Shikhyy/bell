import { ImageResponse } from "next/og";

export const alt = "bell — an opening auction for onchain stocks";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 90, background: "linear-gradient(160deg,#0d1320,#05070b)", color: "#eceef2" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <div style={{ width: 22, height: 22, borderRadius: 11, background: "#ff9e4a" }} />
          <div style={{ fontSize: 120, fontWeight: 700, letterSpacing: -4 }}>bell</div>
        </div>
        <div style={{ fontSize: 48, marginTop: 24, color: "#b4bac8" }}>An opening auction for onchain stocks</div>
        <div style={{ fontSize: 30, marginTop: 56, color: "#78b4ff" }}>Weekend LVR, forecast and auctioned back to LPs · Base</div>
      </div>
    ),
    size,
  );
}
