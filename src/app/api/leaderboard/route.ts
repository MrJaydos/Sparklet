import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { displayName } from "@/lib/display";
import { localDayStart } from "@/lib/xp";

// Ports the ranking logic straight out of src/app/leaderboard/page.tsx —
// that page does the today/week/all-time/friends ranking via direct Prisma
// queries with no API route backing it, so native clients had nothing to
// call. Kept as one route with a `board` query param (mirrors the page's
// own `?board=` search param) rather than four routes, since all four
// boards return the same `{ rows, me }` shape.

const BOARD_KEYS = ["today", "week", "all", "friends"] as const;
type BoardKey = (typeof BOARD_KEYS)[number];

const TOP_N = 20;

type Row = { userId: string; name: string; xp: number };

async function xpBoard(since: Date): Promise<Row[]> {
  const sums = await prisma.xpEvent.groupBy({
    by: ["userId"],
    where: { createdAt: { gte: since } },
    _sum: { amount: true },
    orderBy: { _sum: { amount: "desc" } },
    take: TOP_N,
  });
  if (sums.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: sums.map((s) => s.userId) } },
    select: { id: true, name: true, email: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  return sums.map((s) => {
    const u = byId.get(s.userId);
    return { userId: s.userId, name: u ? displayName(u) : "learner", xp: s._sum.amount ?? 0 };
  });
}

async function myWindowRank(userId: string, since: Date): Promise<{ xp: number; rank: number } | null> {
  const mine = await prisma.xpEvent.aggregate({
    where: { userId, createdAt: { gte: since } },
    _sum: { amount: true },
  });
  const xp = mine._sum.amount ?? 0;
  if (xp === 0) return null;
  const better = await prisma.xpEvent.groupBy({
    by: ["userId"],
    where: { createdAt: { gte: since } },
    _sum: { amount: true },
    having: { amount: { _sum: { gt: xp } } },
  });
  return { xp, rank: better.length + 1 };
}

export async function GET(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const boardParam = req.nextUrl.searchParams.get("board");
  const board: BoardKey = (BOARD_KEYS as readonly string[]).includes(boardParam ?? "")
    ? (boardParam as BoardKey)
    : "today";

  // Same tz query-param convention as GET /api/profile — native clients
  // have no `sparklet.tz` cookie to fall back to.
  const tzOffsetMinutes = Number(req.nextUrl.searchParams.get("tz")) || 0;
  const dayStart = localDayStart(tzOffsetMinutes);
  const weekStart = new Date(dayStart.getTime() - 6 * 86_400_000);

  const self = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { name: true, email: true, xp: true },
  });

  let rows: Row[];
  let me: { xp: number; rank: number } | null;
  if (board === "all") {
    const users = await prisma.user.findMany({
      where: { xp: { gt: 0 } },
      orderBy: { xp: "desc" },
      take: TOP_N,
      select: { id: true, name: true, email: true, xp: true },
    });
    rows = users.map((u) => ({ userId: u.id, name: displayName(u), xp: u.xp }));
    me =
      self.xp > 0
        ? { xp: self.xp, rank: (await prisma.user.count({ where: { xp: { gt: self.xp } } })) + 1 }
        : null;
  } else if (board === "friends") {
    const friendships = await prisma.friendship.findMany({
      where: { status: "ACCEPTED", OR: [{ requesterId: userId }, { addresseeId: userId }] },
      select: { requesterId: true, addresseeId: true },
    });
    const friendIds = friendships.map((f) => (f.requesterId === userId ? f.addresseeId : f.requesterId));
    const candidateIds = [...friendIds, userId];
    const users = await prisma.user.findMany({
      where: { id: { in: candidateIds }, xp: { gt: 0 } },
      orderBy: { xp: "desc" },
      take: TOP_N,
      select: { id: true, name: true, email: true, xp: true },
    });
    rows = users.map((u) => ({ userId: u.id, name: displayName(u), xp: u.xp }));
    me =
      self.xp > 0
        ? {
            xp: self.xp,
            rank:
              (await prisma.user.count({ where: { id: { in: candidateIds }, xp: { gt: self.xp } } })) + 1,
          }
        : null;
  } else {
    const since = board === "today" ? dayStart : weekStart;
    [rows, me] = await Promise.all([xpBoard(since), myWindowRank(userId, since)]);
  }

  return NextResponse.json({
    board,
    rows,
    me,
    inTop: rows.some((r) => r.userId === userId),
    selfName: displayName(self),
    viewerId: userId,
  });
}
