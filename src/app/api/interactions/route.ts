import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { updateStreakOnActivity } from "@/lib/streak";
import { enterReviewSchedule, recordReview, isLongDwell } from "@/lib/sm2";
import { awardXp, getXpToday, isReadXpRateLimited, DAILY_GOAL_XP } from "@/lib/xp";

const bodySchema = z.object({
  cardId: z.string().min(1),
  action: z.enum(["view"]),
  tzOffsetMinutes: z.number().int().optional(),
  dwellMs: z.number().int().min(0).max(3_600_000).optional(),
});

// A card only counts as read (completed → XP, streak, demand signals) after
// this much dwell. Fast swipes still record the card as seen so the feed
// won't repeat it, but earn nothing.
const MIN_READ_MS = 5_000;
// The claimed dwell is client-supplied, so it's verified against the gap
// between our own receipt times: the entry view stamps viewedAt, and the
// read ping must arrive this much later by the server's clock. Slightly
// under MIN_READ_MS to absorb network jitter between the two requests.
const MIN_READ_GAP_MS = 4_500;

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { cardId, tzOffsetMinutes, dwellMs } = parsed.data;
  const tz = tzOffsetMinutes ?? 0;

  const card = await prisma.card.findUnique({
    where: { id: cardId },
    select: { id: true, body: true },
  });
  if (!card) return NextResponse.json({ error: "card not found" }, { status: 404 });

  const existing = await prisma.userCardInteraction.findUnique({
    where: { userId_cardId: { userId, cardId } },
    select: { id: true, completed: true, viewedAt: true },
  });

  // Read = the claimed dwell is long enough AND our own clock agrees: a
  // prior POST for this card (which stamped viewedAt) happened ≥ the gap
  // ago. A single forged request can never complete a card — the row it
  // creates has no prior timestamp — so a bot has to wait out real time
  // per card, same as a person.
  const read =
    (dwellMs ?? 0) >= MIN_READ_MS &&
    existing !== null &&
    Date.now() - existing.viewedAt.getTime() >= MIN_READ_GAP_MS;
  await prisma.userCardInteraction.upsert({
    where: { userId_cardId: { userId, cardId } },
    // Re-views bump viewedAt so profile history reflects recency. A later
    // real read upgrades completed; it never downgrades.
    update: { ...(read ? { completed: true } : {}), viewedAt: new Date() },
    create: { userId, cardId, completed: read },
  });

  // Spaced repetition: dwelling on a due review counts as a successful
  // recall (skimming past one doesn't); an unusually long dwell on a new
  // card enters it into the schedule.
  let reviewRecalled = false;
  const srState = await prisma.spacedRepetitionState.findUnique({
    where: { userId_cardId: { userId, cardId } },
    select: { nextReviewAt: true },
  });
  if (srState && srState.nextReviewAt.getTime() <= Date.now()) {
    if (read) {
      await recordReview(userId, cardId, 4);
      reviewRecalled = true;
    }
  } else if (!srState && dwellMs !== undefined && isLongDwell(dwellMs, card.body)) {
    await enterReviewSchedule(userId, cardId);
  }

  // XP: first real read of a card earns 1, recalling a due review earns 5.
  // Instant swipe-pasts, follow-up posts on an already-read card, and reads
  // beyond the per-minute rate cap award nothing (the card still counts as
  // learned — only the XP is withheld).
  const xp = reviewRecalled
    ? await awardXp(userId, 5, "review", tz)
    : read && !existing?.completed && !(await isReadXpRateLimited(userId))
      ? await awardXp(userId, 1, "read", tz)
      : { awarded: 0, today: await getXpToday(userId, tz), total: 0, goal: DAILY_GOAL_XP };

  // Streaks follow the same rule: flipping past cards isn't activity.
  const streak = read
    ? await updateStreakOnActivity(userId, tz)
    : undefined;
  return NextResponse.json({ ok: true, streak, xp });
}
