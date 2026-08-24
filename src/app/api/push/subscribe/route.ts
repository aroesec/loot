import { limitSession } from "@/lib/http/guard";
import { POLICIES } from "@/lib/http/rate-limit";
import { eq } from "drizzle-orm";
import { guardApi } from "@/lib/auth";
import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { env, hasPush } from "@/lib/env";

/** The public key the browser needs in order to subscribe. */
export async function GET() {
  const denied = await guardApi();
  if (denied) return denied;

  // A handful per device, ever.
  const limited = await limitSession(POLICIES.push);
  if (limited) return limited;
  return Response.json({
    configured: hasPush,
    publicKey: env.VAPID_PUBLIC_KEY ?? null,
  });
}

export async function POST(request: Request) {
  const denied = await guardApi();
  if (denied) return denied;

  // A handful per device, ever.
  const limited = await limitSession(POLICIES.push);
  if (limited) return limited;
  if (!hasPush) {
    return Response.json({ error: "Push is not configured." }, { status: 400 });
  }

  const body = (await request.json()) as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };

  if (!body.endpoint || !body.keys?.p256dh || !body.keys.auth) {
    return Response.json({ error: "Incomplete subscription." }, { status: 400 });
  }

  /*
   * Upsert on the endpoint. A browser re-subscribing produces the same
   * endpoint with rotated keys, so inserting blindly would accumulate dead
   * rows and send each notification several times to one device.
   */
  await db
    .insert(pushSubscriptions)
    .values({
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      authKey: body.keys.auth,
      userAgent: request.headers.get("user-agent")?.slice(0, 200) ?? null,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        p256dh: body.keys.p256dh,
        authKey: body.keys.auth,
        // Re-subscribing revives a device previously marked gone.
        expiredAt: null,
      },
    });

  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const denied = await guardApi();
  if (denied) return denied;

  // A handful per device, ever.
  const limited = await limitSession(POLICIES.push);
  if (limited) return limited;
  const body = (await request.json().catch(() => ({}))) as { endpoint?: string };
  if (!body.endpoint) {
    return Response.json({ error: "No endpoint given." }, { status: 400 });
  }
  await db
    .delete(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, body.endpoint));
  return Response.json({ ok: true });
}
