import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

/**
 * Flips reader suggestions from PENDING to INCLUDED once the content
 * generator (CI, no DB access — see AGENTS.md) has woven them into a
 * category's generation prompt via /api/inventory. Token-authed the same
 * way as the other cron-facing /api/admin/* routes (Authorization: Bearer
 * $REVALIDATE_TOKEN), called from scripts/generate-content.ts itself rather
 * than a GitHub Action, since it fires mid-script right after each prompt
 * is built.
 */

const bodySchema = z.object({ ids: z.array(z.string()).min(1).max(50) });

export async function POST(req: NextRequest) {
  const token = process.env.REVALIDATE_TOKEN;
  const provided = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token || provided !== token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const { count } = await prisma.cardSuggestion.updateMany({
    where: { id: { in: parsed.data.ids }, status: "PENDING" },
    data: { status: "INCLUDED", includedAt: new Date() },
  });
  return NextResponse.json({ ok: true, updated: count });
}
