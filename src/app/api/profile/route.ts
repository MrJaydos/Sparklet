import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getXpToday, getCardsToday, DAILY_GOAL_XP } from "@/lib/xp";

const bodySchema = z.object({ name: z.string().trim().max(40) });

// tz: query param first (native/non-browser clients that can't set the
// sparklet.tz cookie), falling back to the cookie the web client sets in
// Feed.tsx — same convention as the tzOffsetMinutes body field on the
// interaction/answer POST routes, just carried via query since GET has no body.
export async function GET(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const tzQuery = Number(req.nextUrl.searchParams.get("tz"));
  const tzCookie = Number((await cookies()).get("sparklet.tz")?.value);
  const tzOffsetMinutes = Number.isFinite(tzQuery) && req.nextUrl.searchParams.has("tz")
    ? tzQuery
    : Number.isFinite(tzCookie)
      ? tzCookie
      : 0;

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { xp: true, currentStreak: true, longestStreak: true, streakFreezesAvailable: true },
  });
  const [xpToday, cardsToday] = await Promise.all([
    getXpToday(userId, tzOffsetMinutes),
    getCardsToday(userId, tzOffsetMinutes),
  ]);

  return NextResponse.json({
    xp: user.xp,
    xpToday,
    xpGoal: DAILY_GOAL_XP,
    cardsToday,
    currentStreak: user.currentStreak,
    longestStreak: user.longestStreak,
    freezesAvailable: user.streakFreezesAvailable,
  });
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const name = parsed.data.name || null; // empty string clears the name
  await prisma.user.update({ where: { id: userId }, data: { name } });
  return NextResponse.json({ ok: true, name });
}
