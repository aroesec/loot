import webpush from "web-push";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { notificationsSent, pushSubscriptions } from "@/db/schema";
import { env, hasPush } from "@/lib/env";

/**
 * Sending a notification to the household's devices.
 *
 * Web Push rather than a hosted service: it is a browser standard, needs no
 * third party between this app and the device, and behaves identically on a
 * self-hosted deployment. Routing someone's spending alerts through another
 * company's infrastructure would be a strange thing for an app whose entire
 * premise is that the data stays yours.
 *
 * Every send is deduplicated by a caller-supplied key. That is the difference
 * between a useful alert and one that gets switched off: "you are over on
 * groceries" is worth saying once this month, not every morning for three
 * weeks. Notification fatigue does not degrade the feature, it ends it.
 */

let configured = false;

function ensureConfigured(): void {
  if (configured) return;
  if (!hasPush) throw new Error("Push is not configured.");
  webpush.setVapidDetails(
    env.VAPID_SUBJECT || "mailto:noreply@example.com",
    env.VAPID_PUBLIC_KEY!,
    env.VAPID_PRIVATE_KEY!,
  );
  configured = true;
}

export type Notification = {
  /** Stable per logical alert, so it is sent once rather than daily. */
  dedupeKey: string;
  title: string;
  body: string;
  /** Where tapping it should land. */
  url?: string;
};

export type SendResult = {
  sent: number;
  skippedDuplicate: boolean;
  expired: number;
  /** Per-channel outcome, so a partial delivery is visible. */
  channels?: Array<{ channel: string; sent: number; error?: string }>;
};

/**
 * Send to every active subscription, once.
 *
 * A subscription the push service reports as gone is marked expired rather
 * than deleted, so a stale client cannot silently resurrect it — and so the UI
 * can show that a device dropped off rather than the row simply vanishing.
 */
export async function sendNotification(
  notification: Notification,
): Promise<SendResult> {
  /*
   * Claim the dedupe key first. Inserting before delivering means a crash
   * mid-send suppresses a repeat rather than causing one — the safer failure,
   * because a missed alert is recoverable and a notification loop is not.
   *
   * The claim covers every channel, so an alert is not texted and pushed on
   * one run and texted again on the next.
   */
  const claimed = await db
    .insert(notificationsSent)
    .values({
      dedupeKey: notification.dedupeKey,
      title: notification.title,
      body: notification.body,
    })
    .onConflictDoNothing({ target: notificationsSent.dedupeKey })
    .returning({ id: notificationsSent.id });

  if (claimed.length === 0) {
    return { sent: 0, skippedDuplicate: true, expired: 0 };
  }

  const { deliver } = await import("./channels");
  const results = await deliver(notification);

  return {
    sent: results.reduce((a, r) => a + r.sent, 0),
    skippedDuplicate: false,
    expired: 0,
    channels: results,
  };
}

/** Push delivery itself, called by the push channel. */
export async function sendToSubscribers(
  notification: Notification,
): Promise<number> {
  if (!hasPush) return 0;
  ensureConfigured();

  const subscriptions = await db
    .select()
    .from(pushSubscriptions)
    .where(isNull(pushSubscriptions.expiredAt));

  const payload = JSON.stringify({
    title: notification.title,
    body: notification.body,
    url: notification.url ?? "/",
  });

  let sent = 0;
  let expired = 0;

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.authKey },
        },
        payload,
      );
      sent += 1;
      await db
        .update(pushSubscriptions)
        .set({ lastNotifiedAt: new Date() })
        .where(eq(pushSubscriptions.id, sub.id));
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      // 404/410 mean the browser dropped it — uninstalled, or permission revoked.
      if (status === 404 || status === 410) {
        expired += 1;
        await db
          .update(pushSubscriptions)
          .set({ expiredAt: new Date() })
          .where(eq(pushSubscriptions.id, sub.id));
      } else {
        console.error("push send failed", status, err);
      }
    }
  }

  if (expired > 0) console.log(`push: ${expired} subscription(s) expired`);
  return sent;
}

export async function activeSubscriptionCount(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(pushSubscriptions)
    .where(isNull(pushSubscriptions.expiredAt));
  return row?.count ?? 0;
}

/** Clear old dedupe rows so the table does not grow without bound. */
export async function pruneNotificationHistory(days = 400): Promise<number> {
  const rows = await db
    .delete(notificationsSent)
    .where(sql`${notificationsSent.sentAt} < now() - make_interval(days => ${days})`)
    .returning({ id: notificationsSent.id });
  return rows.length;
}
