import { prisma } from "@/lib/db";

/**
 * SM-2 spaced repetition over cards. Cards enter the schedule when a user
 * likes them or lingers unusually long; reviews surface in the feed when due.
 *
 * Quality grades (0-5) are inferred from behavior rather than self-grading:
 *   re-viewing a due card = 4, quiz correct = 5, quiz wrong = 2.
 */

export async function enterReviewSchedule(userId: string, cardId: string) {
  const tomorrow = new Date(Date.now() + 86_400_000);
  await prisma.spacedRepetitionState.upsert({
    where: { userId_cardId: { userId, cardId } },
    update: {}, // already scheduled — leave its state alone
    create: { userId, cardId, nextReviewAt: tomorrow },
  });
}

export async function recordReview(userId: string, cardId: string, quality: 0 | 1 | 2 | 3 | 4 | 5) {
  const state = await prisma.spacedRepetitionState.findUnique({
    where: { userId_cardId: { userId, cardId } },
  });
  if (!state) return;

  let { easeFactor, intervalDays, repetitionCount } = state;
  easeFactor = Math.max(
    1.3,
    easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
  );
  if (quality < 3) {
    repetitionCount = 0;
    intervalDays = 1;
  } else {
    repetitionCount += 1;
    intervalDays =
      repetitionCount === 1 ? 1 : repetitionCount === 2 ? 6 : Math.round(intervalDays * easeFactor);
  }

  await prisma.spacedRepetitionState.update({
    where: { userId_cardId: { userId, cardId } },
    data: {
      easeFactor,
      intervalDays,
      repetitionCount,
      nextReviewAt: new Date(Date.now() + intervalDays * 86_400_000),
    },
  });
}

/**
 * Whether a dwell counts as "unusually long" for this card: more than twice
 * the estimated reading time and at least 12 seconds.
 */
export function isLongDwell(dwellMs: number, body: string): boolean {
  const words = body.split(/\s+/).length;
  const estimatedMs = words * 300; // ~200 wpm
  return dwellMs >= 12_000 && dwellMs > estimatedMs * 2;
}
