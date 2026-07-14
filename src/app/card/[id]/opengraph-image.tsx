import { ImageResponse } from "next/og";
import { prisma } from "@/lib/db";

/**
 * Social-share image for a card: category-colored gradient, the fact's
 * title and a teaser of the body. This is what a pasted link unfurls into
 * in a group chat — it carries the "did you know?!" moment.
 */

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const card = await prisma.card.findUnique({
    where: { id },
    select: {
      title: true,
      body: true,
      published: true,
      category: { select: { name: true, colorHex: true, icon: true } },
    },
  });

  const color = card?.published ? card.category.colorHex : "#8b5cf6";
  const title = card?.published ? card.title : "Sparklet";
  const body = card?.published
    ? card.body.length > 180
      ? `${card.body.slice(0, 180).trimEnd()}…`
      : card.body
    : "A feed of fact-checked learning cards.";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: `linear-gradient(150deg, ${color}55 0%, #0a0a0a 55%, #0a0a0a 100%)`,
          color: "#f5f5f5",
          fontFamily: "sans-serif",
        }}
      >
        {card?.published && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              backgroundColor: `${color}33`,
              color,
              borderRadius: 9999,
              padding: "10px 26px",
              fontSize: 30,
              fontWeight: 700,
              alignSelf: "flex-start",
            }}
          >
            {`${card.category.icon} ${card.category.name}`}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 62, fontWeight: 800, lineHeight: 1.15 }}>{title}</div>
          <div style={{ fontSize: 30, lineHeight: 1.4, color: "#a3a3a3" }}>{body}</div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 30,
          }}
        >
          <div style={{ display: "flex", fontWeight: 800 }}>✨ Sparklet</div>
          <div style={{ display: "flex", color: "#a3a3a3" }}>Learn something in 20 seconds</div>
        </div>
      </div>
    ),
    { ...size, emoji: "twemoji" }
  );
}
