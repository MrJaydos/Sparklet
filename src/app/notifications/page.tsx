import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export const metadata = { title: "Notifications — Sparklet" };
export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;

  const notifications = await prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      card: { select: { id: true, title: true } },
      comment: { select: { body: true } },
    },
  });

  // Viewing the page marks everything read.
  await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });

  return (
    <main className="mx-auto min-h-dvh w-full max-w-lg px-5 py-8">
      <Link href="/feed" className="text-sm text-neutral-400 hover:text-neutral-200">
        ← Back to feed
      </Link>
      <h1 className="mt-6 text-2xl font-bold">Notifications</h1>

      {notifications.length === 0 ? (
        <p className="mt-4 text-sm text-neutral-500">
          When someone replies in a comment thread you&apos;re part of, it shows up here.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {notifications.map((n) => (
            <li key={n.id}>
              <Link
                href={`/card/${n.card.id}`}
                className={`block rounded-xl border p-4 transition hover:border-neutral-600 ${
                  n.readAt === null
                    ? "border-violet-800 bg-violet-950/30"
                    : "border-neutral-800 bg-neutral-900"
                }`}
              >
                <div className="text-sm">
                  <span className="font-semibold">{n.actorName}</span>{" "}
                  <span className="text-neutral-400">commented on</span>{" "}
                  <span className="font-medium">{n.card.title}</span>
                </div>
                {n.comment && (
                  <p className="mt-1 line-clamp-2 text-sm text-neutral-500">
                    “{n.comment.body}”
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
