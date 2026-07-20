import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { auth, signOut } from "@/auth";
import { prisma } from "@/lib/db";
import { isAdminEmail } from "@/lib/admin";
import { getXpToday, DAILY_GOAL_XP } from "@/lib/xp";
import { getUnreadCount } from "@/lib/notifications";
import { isBillingEnabled } from "@/lib/billing";
import { getKnowledgeMap } from "@/lib/knowledge-map";
import { AppHeader } from "@/components/AppHeader";
import { MapView } from "@/components/MapView";

export const metadata = { title: "Your knowledge map — Sparklet" };
export const dynamic = "force-dynamic";

export default async function MapPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;
  const isAdmin = isAdminEmail(session.user.email);

  const tzRaw = Number((await cookies()).get("sparklet.tz")?.value);
  const tz = Number.isFinite(tzRaw) ? tzRaw : 0;

  const [user, unread, xpToday, map] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { currentStreak: true, longestStreak: true, streakFreezesAvailable: true },
    }),
    getUnreadCount(userId, isAdmin),
    getXpToday(userId, tz),
    getKnowledgeMap(userId),
  ]);

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  return (
    <>
      <AppHeader
        streak={user.currentStreak}
        longestStreak={user.longestStreak}
        freezesAvailable={user.streakFreezesAvailable}
        xpToday={xpToday}
        dailyGoal={DAILY_GOAL_XP}
        unread={unread}
        inviteUrl={`${process.env.NEXTAUTH_URL || "http://localhost:3000"}/invite/${userId}`}
        isAdmin={isAdmin}
        premium={session.user.premium}
        billingEnabled={isBillingEnabled()}
        signOutAction={signOutAction}
      />
      <main className="mx-auto min-h-dvh w-full max-w-lg px-5 pb-8 pt-[calc(env(safe-area-inset-top)+4rem)]">
        <h1 className="mt-6 text-2xl font-bold">🗺️ Your knowledge map</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Every dot is a fact you&apos;ve learned — lines connect related ideas.
        </p>
        {map.nodes.length === 0 ? (
          <p className="mt-8 text-center text-neutral-500">
            Read a few cards and your map will start growing here.
          </p>
        ) : (
          <div className="mt-6">
            <MapView nodes={map.nodes} edges={map.edges} totalLearned={map.totalLearned} />
          </div>
        )}
      </main>
    </>
  );
}
