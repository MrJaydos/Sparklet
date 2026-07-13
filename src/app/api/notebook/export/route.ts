import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

/** Plain-markdown export of the user's saved cards. */
export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const saved = await prisma.savedCard.findMany({
    where: { userId },
    orderBy: { savedAt: "desc" },
    include: {
      card: { include: { category: { select: { name: true } } } },
    },
  });

  const lines: string[] = [
    "# Sparklet notebook",
    "",
    `Exported ${new Date().toISOString().slice(0, 10)} · ${saved.length} card(s)`,
    "",
  ];
  for (const { card, savedAt } of saved) {
    const sources = card.sources as { title: string; publisher: string; url: string }[];
    lines.push(
      `## ${card.title}`,
      "",
      `*${card.category.name} · saved ${savedAt.toISOString().slice(0, 10)}*`,
      "",
      card.body,
      "",
      ...sources.map((s) => `- ${s.title} — ${s.publisher}: ${s.url}`),
      `- Read more: ${card.readMoreUrl}`,
      ""
    );
  }

  return new NextResponse(lines.join("\n"), {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="sparklet-notebook.md"`,
    },
  });
}
