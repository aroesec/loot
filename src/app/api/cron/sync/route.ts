import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { hasPlaid } from "@/lib/env";
import { syncAllItems } from "@/lib/plaid/sync";
import { reconcileCardPayments } from "@/lib/reconcile/debt";
import { pendingAlerts } from "@/lib/notify/alerts";
import { sendNotification } from "@/lib/notify/push";
import { isAuthenticated } from "@/lib/auth";
import { limitCredentialAttempt } from "@/lib/http/guard";
import { POLICIES } from "@/lib/http/rate-limit";

/**
 * The scheduled sync.
 *
 * Bandwidth is not the constraint people expect. `transactions/sync` sends only
 * what changed since the cursor, so a daily run moves a few kilobytes rather
 * than re-downloading history — and Plaid bills Transactions as a monthly
 * subscription per Item, not per call, so syncing daily costs exactly the same
 * as syncing monthly.
 *
 * What a daily run does buy is a ledger that is never more than a day stale,
 * and pending charges that get updated as they settle instead of sitting at
 * their authorization amount.
 */
export const maxDuration = 300;

function authorized(request: Request): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;

  // Constant-time: a length or prefix leak here is a free pass to the endpoint.
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  /*
   * Either the scheduler's secret or a signed-in session. The second is what
   * makes this testable by hand without weakening the first.
   */
  if (!authorized(request) && !(await isAuthenticated())) {
    /*
     * Counted only on failure, so the scheduler's own daily call never touches
     * the limit however often it runs — but someone grinding guesses at
     * CRON_SECRET runs out of attempts. The 429 is returned in place of the
     * 401 so a prober cannot tell which of the two they hit.
     */
    const limited = await limitCredentialAttempt(request, POLICIES.badCredential);
    if (limited) return limited;
    return Response.json({ error: "Not authorized" }, { status: 401 });
  }

  if (!hasPlaid) {
    return Response.json({ skipped: "Bank syncing is not configured." });
  }

  const started = Date.now();
  const reports = await syncAllItems();

  /*
   * Reconciliation runs after every sync, in both directions. Importing a
   * card's charges has to move its payments back to transfers, and that moment
   * arrives during a sync — leaving it until someone notices would mean the
   * money is counted twice in between.
   */
  const debt = await reconcileCardPayments();

  /*
   * Alerts run after reconciliation, so a large charge is described by its
   * settled category rather than whatever it looked like mid-sync.
   */
  const addedIds = reports.flatMap((r) => r.addedIds ?? []);
  let notified = 0;
  try {
    for (const alert of await pendingAlerts({ addedTransactionIds: addedIds })) {
      const result = await sendNotification(alert);
      if (result.sent > 0) notified += 1;
    }
  } catch (err) {
    // A notification failure must never fail the sync that produced the data.
    console.error("alerting failed", err);
  }

  const added = reports.reduce((a, r) => a + r.added, 0);
  const updated = reports.reduce((a, r) => a + r.updated, 0);
  const failed = reports.filter((r) => r.error);

  if (failed.length > 0) {
    console.error(
      "scheduled sync had failures:",
      failed.map((f) => `${f.institution}: ${f.error}`).join(" · "),
    );
  }

  return Response.json({
    ok: failed.length === 0,
    ms: Date.now() - started,
    added,
    updated,
    banks: reports.length,
    notificationsSent: notified,
    debtReclassified: debt.toDebt,
    debtRestored: debt.toTransfer,
    errors: failed.map((f) => ({ institution: f.institution, error: f.error })),
  });
}
