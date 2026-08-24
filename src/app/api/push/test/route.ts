import { limitSession } from "@/lib/http/guard";
import { POLICIES } from "@/lib/http/rate-limit";
import { guardApi } from "@/lib/auth";
import { sendNotification } from "@/lib/notify/push";

/** Sends one notification, so a device can be checked without waiting a day. */
export async function POST() {
  const denied = await guardApi();
  if (denied) return denied;

  // Sends a real notification to every registered device.
  const limited = await limitSession(POLICIES.pushTest);
  if (limited) return limited;

  const result = await sendNotification({
    // Timestamped so a test can be repeated; real alerts are keyed by event.
    dedupeKey: `test-${Date.now()}`,
    title: "Loot is connected",
    body: "Alerts will arrive here when something is worth telling you.",
    url: "/goals",
  });

  return Response.json(result);
}
