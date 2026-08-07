import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

type Row = {
  id: string;
  title: string;
  createdAt: Date;
  name: string;
  icon: string;
  colorHex: string;
};

// Content lookup only — no personalization, so it's public like /card/[id].
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim().slice(0, 100) ?? "";
  if (!q) return NextResponse.json({ results: [] });

  let rows = await prisma.$queryRaw<Row[]>`
    SELECT c.id, c.title, c."createdAt", cat.name, cat.icon, cat."colorHex"
    FROM "Card" c
    JOIN "Category" cat ON cat.id = c."categoryId"
    WHERE c.published
      AND c."depthLevel" = 'STANDARD'
      AND c."search" @@ websearch_to_tsquery('english', ${q})
    ORDER BY ts_rank(c."search", websearch_to_tsquery('english', ${q})) DESC
    LIMIT 20
  `;

  if (rows.length === 0) {
    // Partial words ("quant") don't stem-match; fall back to substring on title.
    // Escape LIKE's own wildcards first — the value is parameterized, so this
    // was never injectable, but an unescaped "%" or "_" is a wildcard the
    // caller didn't ask for: a lone "%" matches every published card and
    // makes Postgres scan the whole table on an endpoint anyone can hit.
    const literal = q.replace(/[\\%_]/g, (ch) => `\\${ch}`);
    rows = await prisma.$queryRaw<Row[]>`
      SELECT c.id, c.title, c."createdAt", cat.name, cat.icon, cat."colorHex"
      FROM "Card" c
      JOIN "Category" cat ON cat.id = c."categoryId"
      WHERE c.published
        AND c."depthLevel" = 'STANDARD'
        AND c.title ILIKE ${"%" + literal + "%"}
      ORDER BY c.score DESC
      LIMIT 20
    `;
  }

  return NextResponse.json({
    results: rows.map((r) => ({
      id: r.id,
      title: r.title,
      createdAt: r.createdAt,
      category: { name: r.name, icon: r.icon, colorHex: r.colorHex },
    })),
  });
}
