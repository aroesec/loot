import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { categories, transactions } from "@/db/schema";
import { bufferStatus, recentFlows } from "@/lib/buffer";
import { unreconciledByIssuer } from "@/lib/reconcile/debt";
import { currentMonth, monthBounds } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import type { Notification } from "./push";

/**
 * Deciding what is worth interrupting someone for.
 *
 * This is the hard half. Sending a notification is a solved problem; choosing
 * which facts justify one is not, and getting it wrong ends the feature —
 * people do not tune noisy alerts, they turn them off, and then the useful
 * one never arrives either.
 *
 * Three rules, all of which reject things that would be easy to send:
 *
 * **Only what is actionable or genuinely surprising.** "You spent $42 at a
 * supermarket" is neither. A buffer that has fallen below two weeks is both.
 *
 * **Once per logical event, not once per run.** The dedupe key encodes the
 * thing, not the moment — `buffer-low-2026-08` rather than a timestamp — so a
 * daily job says it once a month rather than every morning.
 *
 * **Silence is a valid output.** A day with nothing worth saying should
 * produce no notification at all. Most days are that day.
 */

export type AlertContext = {
  /** Rows added by the sync that produced this run. */
  addedTransactionIds: string[];
};

/**
 * A charge large enough to be worth knowing about immediately.
 *
 * The threshold is derived from the household's own history rather than fixed:
 * $500 is unremarkable for one person and alarming for another, and a constant
 * would be wrong for almost everybody. Ten times the median transaction is
 * high enough to stay quiet on an ordinary week.
 */
async function largeChargeAlerts(
  context: AlertContext,
): Promise<Notification[]> {
  if (context.addedTransactionIds.length === 0) return [];

  const [stats] = await db
    .select({
      median: sql<string>`COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY -${transactions.amountCents}), 0)`,
    })
    .from(transactions)
    .where(
      and(
        sql`${transactions.amountCents} < 0`,
        eq(transactions.isTransfer, false),
      ),
    );

  const median = Number(stats?.median ?? 0);
  // A floor as well, so a household of tiny transactions is not alerted on $80.
  const threshold = Math.max(median * 10, 25_000);

  const large = await db
    .select({
      id: transactions.id,
      postedOn: transactions.postedOn,
      amountCents: transactions.amountCents,
      merchant: transactions.merchant,
      description: transactions.rawDescription,
      category: categories.name,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(
      and(
        sql`${transactions.id} = ANY(${context.addedTransactionIds})`,
        sql`-${transactions.amountCents} >= ${threshold}`,
        eq(transactions.isTransfer, false),
      ),
    );

  return large.map((t) => ({
    // Keyed by the transaction, so a re-run never repeats it.
    dedupeKey: `large-charge-${t.id}`,
    title: `${formatCents(-t.amountCents)} — ${t.merchant ?? "new charge"}`,
    body: `${t.category ?? "Uncategorized"} on ${t.postedOn}. ${t.description.slice(0, 80)}`,
    url: "/transactions",
  }));
}

/**
 * The cushion has fallen below a fortnight.
 *
 * Worth interrupting for because it is the condition that turns an ordinary
 * irregular expense into a forced liquidation, and because it is invisible
 * otherwise — nothing about a normal day tells you the buffer is thin.
 */
async function bufferAlerts(): Promise<Notification[]> {
  const month = currentMonth();
  const buffer = await bufferStatus(month, 3);

  if (buffer.monthsCovered === null || buffer.baselineMonthlyCents === 0) {
    return [];
  }
  if (buffer.monthsCovered >= 0.5) return [];

  const weeks = buffer.monthsCovered * 4.345;

  return [
    {
      // Once a month: the condition persists, and repeating it daily would
      // teach the reader to ignore it.
      dedupeKey: `buffer-low-${month}`,
      title: `Cash covers about ${weeks.toFixed(1)} weeks`,
      body:
        `${formatCents(buffer.liquidCents ?? 0)} liquid against a typical month of ` +
        `${formatCents(buffer.baselineMonthlyCents)}. An unplanned expense would have to come from somewhere else.`,
      url: "/goals",
    },
  ];
}

/**
 * Spending this month is running ahead of the same point in a normal month.
 *
 * Compared against the *pace* of previous months rather than their totals,
 * because a comparison on the 8th against a full month's spending would fire
 * every month and mean nothing.
 */
async function paceAlerts(): Promise<Notification[]> {
  const month = currentMonth();
  const flows = await recentFlows(month, 6);
  if (flows.length < 2) return [];

  const typical =
    flows.reduce((a, f) => a + f.consumptionCents, 0) / flows.length;

  const { start } = monthBounds(month);
  const today = new Date().toISOString().slice(0, 10);
  const dayOfMonth = Number(today.slice(8, 10));
  const daysInMonth = Number(monthBounds(month).end.slice(8, 10));

  // Too early to say anything: a single large day would trigger it.
  if (dayOfMonth < 10) return [];

  const [row] = await db
    .select({
      spent: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.amountCents} < 0 AND NOT ${transactions.isTransfer} THEN -${transactions.amountCents} ELSE 0 END), 0)`,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(
      and(
        gte(transactions.postedOn, start),
        sql`${transactions.postedOn} <= ${today}`,
        sql`${categories.slug} NOT IN ('investments','investment-withdrawal','card-payment','transfer','debt-payment')`,
      ),
    );

  const spent = Number(row?.spent ?? 0);
  const expectedByNow = typical * (dayOfMonth / daysInMonth);
  if (expectedByNow <= 0) return [];

  const ratio = spent / expectedByNow;
  if (ratio < 1.25) return [];

  return [
    {
      // Once per month per severity step, so crossing 25% and later 50% both
      // say something, but drifting between them does not.
      dedupeKey: `pace-${month}-${Math.floor(ratio * 4)}`,
      title: `Spending is ${Math.round((ratio - 1) * 100)}% ahead of a normal month`,
      body:
        `${formatCents(spent)} by day ${dayOfMonth}, against about ` +
        `${formatCents(Math.round(expectedByNow))} at this point in a typical month.`,
      url: "/",
    },
  ];
}

/** A card whose payments are counted as debt because its charges are missing. */
async function unreconciledAlerts(): Promise<Notification[]> {
  const issuers = await unreconciledByIssuer();
  if (issuers.length === 0) return [];

  const total = issuers.reduce((a, i) => a + i.paymentsCents, 0);
  const month = currentMonth();

  return [
    {
      dedupeKey: `unreconciled-${month}`,
      title: "A card's spending is invisible",
      body:
        `${issuers.map((i) => i.issuer).join(", ")} — ${formatCents(total)} of payments ` +
        `counted as debt, with no idea what they bought. Linking the card fixes it.`,
      url: "/cards",
    },
  ];
}

/**
 * Everything worth sending right now.
 *
 * Ordered by how much the reader can do about it: a specific charge first, then
 * conditions. Callers send them all; deduplication happens per notification.
 */
export async function pendingAlerts(
  context: AlertContext,
): Promise<Notification[]> {
  const groups = await Promise.all([
    largeChargeAlerts(context),
    bufferAlerts(),
    paceAlerts(),
    unreconciledAlerts(),
  ]);
  return groups.flat();
}
