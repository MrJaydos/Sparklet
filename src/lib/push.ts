import webpush from "web-push";
import { prisma } from "@/lib/db";

/**
 * Web Push wrapper. Degrades to a no-op when VAPID keys are unset (dev,
 * fresh deploys): the client hides the reminders UI when /api/push/vapid
 * reports push is unconfigured.
 *
 * Generate keys once with `npx web-push generate-vapid-keys` and set
 * VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (+ optional VAPID_SUBJECT).
 */

export const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY ?? "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@sparklet";

export const pushConfigured = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
if (pushConfigured) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

export type PushPayload = {
  title: string;
  body: string;
  url: string; // where a tap lands, e.g. "/feed"
};

/**
 * Send to every subscription a user has registered; prunes subscriptions
 * the push service reports gone (404/410 — browser revoked or app removed).
 * Returns how many deliveries were accepted by the push service.
 */
export async function pushToUser(userId: string, payload: PushPayload): Promise<number> {
  if (!pushConfigured) return 0;
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  let delivered = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
        { TTL: 12 * 3600 } // stale nudges shouldn't arrive a day late
      );
      delivered++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
      }
      // Other failures (throttling, transient) are dropped — nudges are
      // best-effort and tomorrow's run will try again.
    }
  }
  return delivered;
}
