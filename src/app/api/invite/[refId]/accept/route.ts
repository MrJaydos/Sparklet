import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { displayName } from "@/lib/display";

// Ports src/app/invite/[refId]/page.tsx's logic — that page does the
// auto-friend + streak-freeze reward inline in a server component with no
// API route backing it. Unlike the web (which login-gates via a redirect
// query param), a native client is always already signed in by the time it
// can reach this screen, so there's no equivalent redirect concern here.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ refId: string }> }
) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { refId } = await params;

  const referrer = await prisma.user.findUnique({
    where: { id: refId },
    select: { id: true, name: true, email: true },
  });

  if (!referrer) {
    return NextResponse.json({ status: "invalid", referrerName: null, rewardGranted: false });
  }
  if (referrer.id === userId) {
    return NextResponse.json({ status: "self", referrerName: null, rewardGranted: false });
  }

  const [me, completedCount, existing] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { referredById: true } }),
    prisma.userCardInteraction.count({ where: { userId, completed: true } }),
    prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId: userId, addresseeId: referrer.id },
          { requesterId: referrer.id, addresseeId: userId },
        ],
      },
    }),
  ]);

  // Gate the reward on this being a genuinely new account arriving via this
  // link, not an existing user (who'd almost certainly have at least one
  // completed card) or a repeat visit re-triggering it.
  const isNewReferral = me.referredById === null && completedCount === 0;
  const status = existing?.status === "ACCEPTED" ? "already" : "friended";

  await prisma.$transaction(async (tx) => {
    if (!existing) {
      await tx.friendship.create({
        data: {
          requesterId: referrer.id,
          addresseeId: userId,
          status: "ACCEPTED",
          respondedAt: new Date(),
        },
      });
    } else if (existing.status === "PENDING") {
      await tx.friendship.update({
        where: { id: existing.id },
        data: { status: "ACCEPTED", respondedAt: new Date() },
      });
    }

    if (isNewReferral) {
      await tx.user.update({ where: { id: userId }, data: { referredById: referrer.id } });
      await tx.user.update({
        where: { id: referrer.id },
        data: { streakFreezesAvailable: { increment: 1 } },
      });
    }
  });

  return NextResponse.json({
    status,
    referrerName: displayName(referrer),
    rewardGranted: isNewReferral,
  });
}
