import { limitSession } from "@/lib/http/guard";
import { POLICIES } from "@/lib/http/rate-limit";
import { guardApi } from "@/lib/auth";
import { hasPlaid } from "@/lib/env";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { plaidItems } from "@/db/schema";
import { syncAllItems, syncItem } from "@/lib/plaid/sync";

/** Transactions can take a while across several institutions. */
export const maxDuration = 300;

export async function POST(request: Request) {
  const denied = await guardApi();
  if (denied) return denied;

  // Billed per call by Plaid, and rate-limited on their side too.
  const limited = await limitSession(POLICIES.plaidSync);
  if (limited) return limited;
  if (!hasPlaid) {
    return Response.json({ error: "Bank syncing is not configured." }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    itemId?: string;
    fullHistory?: boolean;
  };

  /*
   * A cursor reset is what makes a widened history window actually arrive.
   * `transactions/sync` returns changes since the cursor, so after Link update
   * mode extends an Item from 90 days to two years, the older transactions are
   * not "changes" and would never be sent. Clearing the cursor asks for
   * everything; `plaid_transaction_id` is unique, so the rows already stored
   * update in place rather than duplicating.
   */
  if (body.itemId && body.fullHistory) {
    await db
      .update(plaidItems)
      .set({ cursor: null })
      .where(eq(plaidItems.id, body.itemId));
  }

  const reports = body.itemId
    ? [await syncItem(body.itemId, { refresh: !body.fullHistory })]
    : await syncAllItems();

  return Response.json({ reports });
}
