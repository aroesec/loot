import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, categories, transactions } from "@/db/schema";
import { issuerFromDescription } from "./issuer";

export { issuerFromDescription } from "./issuer";

/**
 * Deciding whether a card payment is a transfer or a debt payment.
 *
 * The same row means two different things depending on what else is in the
 * ledger, which is why this cannot be a classification rule. A rule reads a
 * description; this reads the state of the ledger.
 *
 *   The card's charges ARE imported → the payment is a transfer. The purchases
 *   are the spending and counting the payment too would count it twice.
 *
 *   The card's charges are NOT imported → the payment is a debt payment, and
 *   it counts. Nothing else represents where that money went, and excluding it
 *   deletes real spending from the totals. It is a stand-in for unknown
 *   purchases: better than zero, worse than the truth.
 *
 * **This works from the payments outward, not from the accounts inward**, and
 * that is the whole point. The first version enumerated card accounts and
 * looked for ones with no charges, which cannot see a card that was never
 * created as an account at all. An `APPLECARD GSBANK PAYMENT` sat excluded
 * across two months with nothing behind it and nothing to notice it, because
 * there was no Apple Card row to enumerate.
 *
 * A payment is reconciled only when it can be tied to an account that actually
 * holds charges. Unresolvable is treated exactly like unlinked: both mean the
 * ledger cannot say what the money bought.
 */

export type UnreconciledPayment = {
  id: string;
  postedOn: string;
  amountCents: number;
  description: string;
  /** The issuer as best we can name it, for grouping and for the UI. */
  issuer: string;
  /** Null when no account could be resolved at all. */
  accountId: string | null;
  reason: "no-account" | "account-has-no-charges";
};

export type UnreconciledGroup = {
  issuer: string;
  accountId: string | null;
  reason: "no-account" | "account-has-no-charges";
  paymentCount: number;
  paymentsCents: number;
  earliestPaymentOn: string;
  latestPaymentOn: string;
};

/**
 * Every card payment the ledger cannot account for.
 *
 * Resolution order matters: a last-4 in the description is the strongest
 * signal and is tried first, then the account name. A payment that resolves to
 * an account holding no charges is just as unaccounted-for as one that
 * resolves to nothing.
 */
export async function unreconciledCardPayments(): Promise<UnreconciledPayment[]> {
  /*
   * Charge counts come from a join and a group-by, not a correlated subquery.
   *
   * Drizzle renders a column reference inside a raw `sql` fragment unqualified
   * — `${accounts.id}` becomes `"id"` — and inside a subquery over
   * `transactions`, `"id"` resolves to the *transaction's* id. The comparison
   * silently became `t.account_id = t.id`, which is never true, so every card
   * reported zero charges and every payment looked unreconciled. It produced a
   * wrong answer rather than an error, which is the worst shape a bug can
   * take here.
   */
  const cards = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      last4: accounts.last4,
      charges: sql<string>`COUNT(*) FILTER (
        WHERE ${transactions.amountCents} < 0 AND NOT ${transactions.isTransfer}
      )`,
    })
    .from(accounts)
    .leftJoin(transactions, eq(transactions.accountId, accounts.id))
    .where(eq(accounts.kind, "credit_card"))
    .groupBy(accounts.id, accounts.name, accounts.last4);

  const byLast4 = new Map(
    cards.filter((c) => c.last4).map((c) => [c.last4!, c]),
  );

  const payments = await db
    .select({
      id: transactions.id,
      postedOn: transactions.postedOn,
      amountCents: transactions.amountCents,
      description: transactions.rawDescription,
    })
    .from(transactions)
    .innerJoin(categories, eq(transactions.categoryId, categories.id))
    .where(
      and(
        sql`${transactions.amountCents} < 0`,
        inArray(categories.slug, ["card-payment", "debt-payment"]),
      ),
    )
    .orderBy(transactions.postedOn);

  const out: UnreconciledPayment[] = [];

  for (const p of payments) {
    const d = p.description.toLowerCase();

    const last4 = d.match(/(?:ending in|card)\s*#?\s*(\d{4})/)?.[1];
    let matched = last4 ? byLast4.get(last4) : undefined;

    if (!matched) {
      // Then by name: an account called "Capital One Card" against a
      // description mentioning Capital One.
      matched = cards.find((c) => {
        const first = c.name.toLowerCase().split(" ")[0];
        return first && first.length > 3 && d.includes(first);
      });
    }

    if (matched && Number(matched.charges) > 0) continue;

    out.push({
      id: p.id,
      postedOn: p.postedOn,
      amountCents: p.amountCents,
      description: p.description,
      issuer: issuerFromDescription(p.description),
      accountId: matched?.id ?? null,
      reason: matched ? "account-has-no-charges" : "no-account",
    });
  }

  return out;
}

/** The same thing, grouped by issuer, for warnings and summaries. */
export async function unreconciledByIssuer(): Promise<UnreconciledGroup[]> {
  const payments = await unreconciledCardPayments();
  const groups = new Map<string, UnreconciledGroup>();

  for (const p of payments) {
    const existing = groups.get(p.issuer);
    if (existing) {
      existing.paymentCount += 1;
      existing.paymentsCents += Math.abs(p.amountCents);
      if (p.postedOn < existing.earliestPaymentOn) existing.earliestPaymentOn = p.postedOn;
      if (p.postedOn > existing.latestPaymentOn) existing.latestPaymentOn = p.postedOn;
      continue;
    }
    groups.set(p.issuer, {
      issuer: p.issuer,
      accountId: p.accountId,
      reason: p.reason,
      paymentCount: 1,
      paymentsCents: Math.abs(p.amountCents),
      earliestPaymentOn: p.postedOn,
      latestPaymentOn: p.postedOn,
    });
  }

  return [...groups.values()].sort((a, b) => b.paymentsCents - a.paymentsCents);
}

/**
 * Move unaccounted-for card payments to Debt Payments so they count, and move
 * them back once the card's charges arrive.
 *
 * Both directions, because only handling the forward one leaves a trap: a
 * payment counted as debt *and* the charges behind it counted as spending is
 * the double-count the transfer flag exists to prevent.
 *
 * Manual classifications are left alone, as in every automated pass.
 */
export async function reconcileCardPayments(): Promise<{
  toDebt: number;
  toTransfer: number;
  issuers: UnreconciledGroup[];
}> {
  const slugs = await db
    .select({ id: categories.id, slug: categories.slug })
    .from(categories)
    .where(inArray(categories.slug, ["card-payment", "debt-payment"]));

  const debtId = slugs.find((s) => s.slug === "debt-payment")?.id;
  const cardId = slugs.find((s) => s.slug === "card-payment")?.id;
  if (!debtId || !cardId) {
    throw new Error("card-payment or debt-payment category missing — run db:seed.");
  }

  const unreconciled = await unreconciledCardPayments();
  const unreconciledIds = new Set(unreconciled.map((p) => p.id));

  // Forward: unaccounted-for payments start counting.
  let toDebt = 0;
  if (unreconciledIds.size > 0) {
    const moved = await db
      .update(transactions)
      .set({
        categoryId: debtId,
        isTransfer: false,
        classificationReason:
          "The card behind this payment is not in the ledger, so its purchases are not counted anywhere. " +
          "Counted as a debt payment rather than excluded, because excluding it would delete real spending. " +
          "Link or import that card and this becomes a transfer again.",
        updatedAt: new Date(),
      })
      .where(
        and(
          inArray(transactions.id, [...unreconciledIds]),
          sql`${transactions.classificationSource} <> 'manual'`,
          eq(transactions.isTransfer, true),
        ),
      )
      .returning({ id: transactions.id });
    toDebt = moved.length;
  }

  /*
   * Reverse: a payment currently counted as debt whose card has since been
   * imported. Without this, linking a card double-counts — the payment as debt
   * and the charges as spending.
   */
  const debtRows = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        eq(transactions.categoryId, debtId),
        sql`${transactions.amountCents} < 0`,
        sql`${transactions.classificationSource} <> 'manual'`,
      ),
    );

  const nowReconciled = debtRows
    .map((r) => r.id)
    .filter((id) => !unreconciledIds.has(id));

  let toTransfer = 0;
  if (nowReconciled.length > 0) {
    const moved = await db
      .update(transactions)
      .set({
        categoryId: cardId,
        isTransfer: true,
        classificationReason:
          "The card's own transactions are now in the ledger, so its purchases are the spending. " +
          "Excluded again to avoid counting the same money twice.",
        updatedAt: new Date(),
      })
      .where(inArray(transactions.id, nowReconciled))
      .returning({ id: transactions.id });
    toTransfer = moved.length;
  }

  return { toDebt, toTransfer, issuers: await unreconciledByIssuer() };
}
