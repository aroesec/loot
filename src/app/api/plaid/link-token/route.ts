import { limitSession } from "@/lib/http/guard";
import { POLICIES } from "@/lib/http/rate-limit";
import { eq } from "drizzle-orm";
import { guardApi } from "@/lib/auth";
import { hasPlaid } from "@/lib/env";
import { db } from "@/db";
import { plaidItems } from "@/db/schema";
import { createLinkToken, createUpdateLinkToken } from "@/lib/plaid/link";
import { decryptToken } from "@/lib/plaid/crypto";
import { plaidErrorMessage } from "@/lib/plaid/client";

/**
 * Mints the short-lived token Plaid Link needs to open.
 *
 * Pass `itemId` to repair a broken login: that puts Link in update mode, which
 * fixes the existing Item instead of consuming another one from the free
 * tier's lifetime allowance.
 */
export async function POST(request: Request) {
  const denied = await guardApi();
  if (denied) return denied;

  // Precedes every connection attempt.
  const limited = await limitSession(POLICIES.plaidLink);
  if (limited) return limited;

  if (!hasPlaid) {
    return Response.json(
      {
        error:
          "Bank syncing is not configured. Set PLAID_CLIENT_ID, PLAID_SECRET and PLAID_TOKEN_KEY.",
      },
      { status: 400 },
    );
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      itemId?: string;
    };

    if (body.itemId) {
      const [item] = await db
        .select()
        .from(plaidItems)
        .where(eq(plaidItems.id, body.itemId))
        .limit(1);
      if (!item) {
        return Response.json(
          { error: "That linked bank no longer exists." },
          { status: 404 },
        );
      }
      const linkToken = await createUpdateLinkToken(
        "loot-user",
        decryptToken(item.accessTokenEncrypted),
      );
      return Response.json({ linkToken, mode: "update" });
    }

    return Response.json({
      linkToken: await createLinkToken("loot-user"),
      mode: "create",
    });
  } catch (err) {
    console.error("plaid link token failed", err);
    return Response.json({ error: plaidErrorMessage(err) }, { status: 502 });
  }
}
