import { ImageResponse } from "next/og";

export const alt = "guess the song. Know it in a beat. Six ways to play.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function ShareImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", background: "#151713", color: "#f3f0e6", padding: "64px", alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ display: "flex", flexDirection: "column", width: "66%" }}>
        <div style={{ fontSize: 27, color: "#d7ff3f", marginBottom: 40 }}>guess the song</div>
        <div style={{ fontSize: 100, lineHeight: 1.02, fontWeight: 700 }}>Know it in a beat.</div>
        <div style={{ fontSize: 27, marginTop: 32 }}>Good music. Six ways to play.</div>
      </div>
      <div style={{ display: "flex", width: 310, height: 310, borderRadius: "50%", border: "2px solid #45483e", background: "#252820", alignItems: "center", justifyContent: "center" }}>
        <div style={{ display: "flex", width: 240, height: 240, border: "2px solid #45483e", borderRadius: "50%", alignItems: "center", justifyContent: "center" }}>
          <div style={{ display: "flex", width: 140, height: 140, background: "#d7ff3f", borderRadius: "50%", alignItems: "center", justifyContent: "center", color: "#151713", fontSize: 70 }}>?</div>
        </div>
      </div>
    </div>, size,
  );
}
