import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { displayName } from "@/lib/display";

export const metadata = { title: "Join Sparklet" };
export const dynamic = "force-dynamic";

type Status = "invalid" | "self" | "friended" | "already";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ refId: string }>;
}) {
  const { refId } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/invite/${refId}`)}`);
  }
  const userId = session.user.id;

  const referrer = await prisma.user.findUnique({
    where: { id: refId },
    select: { id: true, name: true, email: true },
  });

  let status: Status;
  let rewardGranted = false;
  if (!referrer) {
    status = "invalid";
  } else if (referrer.id === userId) {
    status = "self";
  } else {
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

    // Gate the reward on this being a genuinely new account arriving via
    // this link, not an existing user (who'd almost certainly have at least
    // one completed card) or a repeat visit re-triggering it.
    const isNewReferral = me.referredById === null && completedCount === 0;

    status = existing?.status === "ACCEPTED" ? "already" : "friended";

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
    rewardGranted = isNewReferral;
  }

  const referrerName = referrer ? displayName(referrer) : "";

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="text-4xl">
        {status === "invalid" ? "🔗" : status === "self" ? "🙂" : "🎉"}
      </div>
      <h1 className="text-2xl font-bold">
        {status === "invalid" && "That invite link isn't valid"}
        {status === "self" && "That's your own invite link"}
        {status === "friended" && `You and ${referrerName} are now friends!`}
        {status === "already" && `You and ${referrerName} are already friends`}
      </h1>
      {rewardGranted && (
        <p className="max-w-sm text-sm text-neutral-400">
          🧊 {referrerName} just earned a bonus streak freeze for inviting you.
        </p>
      )}
      <Link
        href="/feed"
        className="mt-2 rounded-xl bg-violet-600 px-6 py-3 font-semibold text-white transition hover:bg-violet-500"
      >
        Continue to feed
      </Link>
    </main>
  );
}
