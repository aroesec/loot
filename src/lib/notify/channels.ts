import { env } from "@/lib/env";
import type { Notification } from "./push";

/**
 * How a notification reaches someone.
 *
 * Push and SMS are peers rather than one being built on the other, because
 * they fail differently and a household usually wants both for different
 * things: push is free and silent-if-ignored, SMS costs money per message and
 * arrives whether or not the phone has the app.
 *
 * A channel is registered rather than hardcoded so a deployment can add email,
 * Slack, ntfy, Signal, or whatever it already runs, without touching the code
 * that decides *what* to send. That decision — in `alerts.ts` — is the hard
 * part and should not be entangled with delivery.
 */

export type ChannelResult = {
  channel: string;
  sent: number;
  error?: string;
};

export type NotificationChannel = {
  id: string;
  label: string;
  /** False when the deployment has not configured this channel. */
  isConfigured(): boolean;
  /**
   * Deliver one notification. Returns how many recipients it reached, so a
   * channel with no registered devices is distinguishable from a failure.
   */
  send(notification: Notification): Promise<number>;
};

const channels: NotificationChannel[] = [];

export function registerChannel(channel: NotificationChannel): void {
  channels.push(channel);
}

export function listChannels(): readonly NotificationChannel[] {
  return channels;
}

export function configuredChannels(): NotificationChannel[] {
  return channels.filter((c) => c.isConfigured());
}

/**
 * Send through every configured channel.
 *
 * One channel failing must not stop the others — an SMS provider being down is
 * no reason for the push not to arrive, and the alert is usually worth more
 * than the guarantee that it was delivered everywhere.
 */
export async function deliver(
  notification: Notification,
): Promise<ChannelResult[]> {
  const results: ChannelResult[] = [];

  for (const channel of configuredChannels()) {
    try {
      results.push({
        channel: channel.id,
        sent: await channel.send(notification),
      });
    } catch (err) {
      console.error(`channel ${channel.id} failed`, err);
      results.push({
        channel: channel.id,
        sent: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}

/**
 * Web Push to every subscribed browser.
 *
 * Imported lazily so a deployment without push configured does not load the
 * web-push library or touch the subscriptions table at all.
 */
registerChannel({
  id: "push",
  label: "Browser notification",
  isConfigured: () => Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY),
  async send(notification: Notification): Promise<number> {
    const { sendToSubscribers } = await import("./push");
    return sendToSubscribers(notification);
  },
});

/**
 * SMS via Twilio.
 *
 * Registered here rather than in its own file because it is a single HTTP call
 * — the Twilio SDK is a large dependency for one POST, and this keeps the
 * install lean for the majority who will never turn SMS on.
 *
 * Unlike push, **every message costs money**, which changes what belongs on
 * this channel. The alert rules already refuse to send anything routine; that
 * restraint matters more here, where noise has a bill attached.
 */
registerChannel({
  id: "sms",
  label: "Text message",
  isConfigured: () =>
    Boolean(
      env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM && env.ALERT_PHONE,
    ),

  async send(notification: Notification): Promise<number> {
    const sid = env.TWILIO_ACCOUNT_SID!;
    const body =
      // One message: SMS splits above 160 characters and each segment bills.
      `${notification.title}\n${notification.body}`.slice(0, 300);

    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(`${sid}:${env.TWILIO_AUTH_TOKEN}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: env.ALERT_PHONE!,
          From: env.TWILIO_FROM!,
          Body: body,
        }),
      },
    );

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Twilio ${res.status}: ${detail.slice(0, 200)}`);
    }

    return 1;
  },
});
