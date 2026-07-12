import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

// Distinct reporters needed before content is auto-hidden pending review.
const HIDE_THRESHOLD = 5;

const bodySchema = z
  .object({
    cardId: z.string().optional(),
    commentId: z.string().optional(),
    reason: z.enum(["INCORRECT", "INAPPROPRIATE", "SPAM", "OTHER"]),
    detail: z.string().trim().max(500).optional(),
  })
  .refine((b) => !!b.cardId !== !!b.commentId, {
    message: "exactly one of cardId/commentId required",
  });

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  const { cardId, commentId, reason, detail } = parsed.data;

  if (cardId) {
    const card = await prisma.card.findUnique({ where: { id: cardId }, select: { id: true } });
    if (!card) return NextResponse.json({ error: "card not found" }, { status: 404 });
  } else {
    const comment = await prisma.comment.findUnique({
      where: { id: commentId! },
      select: { id: true },
    });
    if (!comment) return NextResponse.json({ error: "comment not found" }, { status: 404 });
  }

  // One report per user per target; repeat reports just update the reason.
  const existing = await prisma.report.findFirst({
    where: { reporterId: userId, cardId: cardId ?? null, commentId: commentId ?? null },
  });
  if (existing) {
    await prisma.report.update({
      where: { id: existing.id },
      data: { reason, detail: detail ?? null },
    });
    return NextResponse.json({ ok: true, alreadyReported: true });
  }

  await prisma.report.create({
    data: { reporterId: userId, cardId, commentId, reason, detail },
  });

  // Auto-hide at threshold, pending manual review — reports are advisory
  // below that so one drive-by flag can't take content down.
  const reporterCount = await prisma.report.groupBy({
    by: ["reporterId"],
    where: { cardId: cardId ?? null, commentId: commentId ?? null, resolvedAt: null },
  });
  if (reporterCount.length >= HIDE_THRESHOLD) {
    if (cardId) {
      await prisma.card.update({
        where: { id: cardId },
        data: {
          published: false,
          reviewNote: `Auto-hidden: reported by ${reporterCount.length} users (latest: ${reason})`,
        },
      });
    } else {
      await prisma.comment.update({
        where: { id: commentId! },
        data: { hiddenAt: new Date() },
      });
    }
  }

  return NextResponse.json({ ok: true });
}
