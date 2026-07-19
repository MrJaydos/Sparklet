import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isAdminEmail } from "@/lib/admin";
import { getAdminAlerts } from "@/lib/notifications";

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const isAdmin = isAdminEmail(session.user?.email);

  const [notifications, notifCount, adminAlerts] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        card: { select: { id: true, title: true } },
        comment: { select: { body: true } },
      },
    }),
    prisma.notification.count({ where: { userId, readAt: null } }),
    isAdmin ? getAdminAlerts() : Promise.resolve([]),
  ]);

  return NextResponse.json({
    unreadCount: notifCount + adminAlerts.reduce((sum, a) => sum + a.count, 0),
    adminAlerts,
    notifications: notifications.map((n) => ({
      id: n.id,
      actorName: n.actorName,
      cardId: n.card.id,
      cardTitle: n.card.title,
      preview: n.comment?.body.slice(0, 80) ?? null,
      createdAt: n.createdAt,
      read: n.readAt !== null,
    })),
  });
}

/** Mark all notifications read. Admin alerts aren't real rows — they clear
 *  themselves once the underlying reports/review queue is resolved. */
export async function POST() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
