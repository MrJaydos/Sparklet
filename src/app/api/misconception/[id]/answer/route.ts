import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { awardXp, getAnswerCombo, comboMultiplier, getXpToday, DAILY_GOAL_XP } from "@/lib/xp";

const bodySchema = z.object({
  guess: z.boolean(),
  tzOffsetMinutes: z.number().int().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const { id } = await params;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  const tz = parsed.data.tzOffsetMinutes ?? 0;

  const misconceptionCard = await prisma.misconceptionCard.findUnique({
    where: { id },
    select: { id: true, cardId: true, answer: true, explanation: true },
  });
  if (!misconceptionCard) return NextResponse.json({ error: "misconception not found" }, { status: 404 });

  const correct = parsed.data.guess === misconceptionCard.answer;

  // Guests get the reveal — the actual learning moment — but nothing is
  // saved or awarded (no account to save it to).
  if (!userId) {
    return NextResponse.json({
      answer: misconceptionCard.answer,
      correct,
      explanation: misconceptionCard.explanation,
      sourceCardId: misconceptionCard.cardId,
      xp: { awarded: 0, today: 0, total: 0, goal: DAILY_GOAL_XP },
      combo: 0,
      multiplier: 1,
      guest: true,
    });
  }

  const prior = await prisma.userMisconceptionAttempt.findUnique({
    where: { userId_misconceptionCardId: { userId, misconceptionCardId: misconceptionCard.id } },
    select: { id: true },
  });
  await prisma.userMisconceptionAttempt.upsert({
    where: { userId_misconceptionCardId: { userId, misconceptionCardId: misconceptionCard.id } },
    update: {}, // first guess stands
    create: {
      userId,
      misconceptionCardId: misconceptionCard.id,
      guess: parsed.data.guess,
      correct,
    },
  });

  // Flat award (no "closeness" for a true/false call) — same shape as quiz's
  // 10/2, not guess's accuracy-scaled formula.
  const combo = correct ? await getAnswerCombo(userId, tz) : 0;
  const multiplier = comboMultiplier(combo);
  const xp = prior
    ? { awarded: 0, today: await getXpToday(userId, tz), total: 0, goal: DAILY_GOAL_XP }
    : await awardXp(userId, (correct ? 8 : 2) * multiplier, "misconception", tz);

  return NextResponse.json({
    answer: misconceptionCard.answer,
    correct,
    explanation: misconceptionCard.explanation,
    sourceCardId: misconceptionCard.cardId,
    xp,
    combo,
    multiplier,
  });
}
