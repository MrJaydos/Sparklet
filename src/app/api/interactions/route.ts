import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { updateStreakOnActivity } from "@/lib/streak";

const bodySchema = z.object({
  cardId: z.string().min(1),
  action: z.enum(["view", "like", "unlike"]),
  tzOffsetMinutes: z.number().int().optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { cardId, action, tzOffsetMinutes } = parsed.data;

  const card = await prisma.card.findUnique({ where: { id: cardId }, select: { id: true } });
  if (!card) return NextResponse.json({ error: "card not found" }, { status: 404 });

  if (action === "view") {
    await prisma.userCardInteraction.upsert({
      where: { userId_cardId: { userId, cardId } },
      update: { completed: true },
      create: { userId, cardId, completed: true },
    });
    const streak = await updateStreakOnActivity(userId, tzOffsetMinutes ?? 0);
    return NextResponse.json({ ok: true, streak });
  }

  const liked = action === "like";
  await prisma.userCardInteraction.upsert({
    where: { userId_cardId: { userId, cardId } },
    update: { liked },
    create: { userId, cardId, liked },
  });
  return NextResponse.json({ ok: true, liked });
}
