import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { displayName } from "@/lib/display";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const comments = await prisma.comment.findMany({
    where: { cardId: id, hiddenAt: null },
    orderBy: { createdAt: "asc" },
    take: 200,
    include: { user: { select: { name: true, email: true } } },
  });

  return NextResponse.json({
    comments: comments.map((c) => ({
      id: c.id,
      body: c.body,
      createdAt: c.createdAt,
      author: displayName(c.user),
      mine: c.userId === userId,
    })),
  });
}

const postSchema = z.object({ body: z.string().trim().min(1).max(500) });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id: cardId } = await params;

  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const card = await prisma.card.findUnique({ where: { id: cardId }, select: { id: true } });
  if (!card) return NextResponse.json({ error: "card not found" }, { status: 404 });

  const me = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { name: true, email: true },
  });

  const comment = await prisma.comment.create({
    data: { cardId, userId, body: parsed.data.body },
  });

  // Notify everyone else in this card's comment thread so they can come back.
  const participants = await prisma.comment.findMany({
    where: { cardId, hiddenAt: null, userId: { not: userId } },
    select: { userId: true },
    distinct: ["userId"],
  });
  if (participants.length) {
    await prisma.notification.createMany({
      data: participants.map((p) => ({
        userId: p.userId,
        actorName: displayName(me),
        cardId,
        commentId: comment.id,
      })),
    });
  }

  return NextResponse.json({
    comment: {
      id: comment.id,
      body: comment.body,
      createdAt: comment.createdAt,
      author: displayName(me),
      mine: true,
    },
  });
}
