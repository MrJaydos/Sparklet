import { prisma } from "@/lib/db";

export type AdminAlert = { id: string; label: string; count: number };

/** Live-computed admin action items — open reports and cards stuck in the
 *  review queue. Not persisted rows; they clear themselves once resolved. */
export async function getAdminAlerts(): Promise<AdminAlert[]> {
  const [openReports, pendingReview] = await Promise.all([
    prisma.report.count({ where: { resolvedAt: null } }),
    prisma.card.count({ where: { published: false } }),
  ]);

  const alerts: AdminAlert[] = [];
  if (openReports > 0) {
    alerts.push({
      id: "admin-reports",
      label: `${openReports} open report${openReports === 1 ? "" : "s"}`,
      count: openReports,
    });
  }
  if (pendingReview > 0) {
    alerts.push({
      id: "admin-review",
      label: `${pendingReview} card${pendingReview === 1 ? "" : "s"} awaiting review`,
      count: pendingReview,
    });
  }
  return alerts;
}

/** Live-computed personal action items — pending incoming friend requests.
 *  Not persisted rows; they clear themselves once accepted/declined. */
export async function getFriendAlerts(userId: string): Promise<AdminAlert[]> {
  const pending = await prisma.friendship.count({
    where: { addresseeId: userId, status: "PENDING" },
  });
  if (pending === 0) return [];
  return [
    {
      id: "friend-requests",
      label: `${pending} friend request${pending === 1 ? "" : "s"}`,
      count: pending,
    },
  ];
}

/** Notification-bell badge count — real unread notifications, plus admin
 *  action items when the viewer is an admin, plus pending friend requests
 *  for everyone. */
export async function getUnreadCount(userId: string, isAdmin: boolean): Promise<number> {
  const [notifCount, adminAlerts, friendAlerts] = await Promise.all([
    prisma.notification.count({ where: { userId, readAt: null } }),
    isAdmin ? getAdminAlerts() : Promise.resolve([]),
    getFriendAlerts(userId),
  ]);
  const alertTotal = [...adminAlerts, ...friendAlerts].reduce((sum, a) => sum + a.count, 0);
  return notifCount + alertTotal;
}
