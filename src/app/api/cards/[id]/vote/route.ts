import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

const bodySchema = z.object({ value: z.union([z.literal(-1), z.literal(0), z.literal(1)]) });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id: cardId } = await params;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  const value = parsed.data.value;

  const card = await prisma.card.findUnique({ where: { id: cardId }, select: { id: true } });
  if (!card) return NextResponse.json({ error: "card not found" }, { status: 404 });

  const updated = await prisma.$transaction(async (tx) => {
    const existing = await tx.userCardInteraction.upsert({
      where: { userId_cardId: { userId, cardId } },
      update: {},
      create: { userId, cardId },
      select: { vote: true },
    });
    const delta = value - existing.vote;
    await tx.userCardInteraction.update({
      where: { userId_cardId: { userId, cardId } },
      data: { vote: value },
    });
    return tx.card.update({
      where: { id: cardId },
      data: { score: { increment: delta } },
      select: { score: true },
    });
  });

  return NextResponse.json({ ok: true, score: updated.score, myVote: value });
}
