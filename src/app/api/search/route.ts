import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

type Row = {
  id: string;
  title: string;
  createdAt: Date;
  name: string;
  icon: string;
  colorHex: string;
};

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

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
    rows = await prisma.$queryRaw<Row[]>`
      SELECT c.id, c.title, c."createdAt", cat.name, cat.icon, cat."colorHex"
      FROM "Card" c
      JOIN "Category" cat ON cat.id = c."categoryId"
      WHERE c.published
        AND c."depthLevel" = 'STANDARD'
        AND c.title ILIKE ${"%" + q + "%"}
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
