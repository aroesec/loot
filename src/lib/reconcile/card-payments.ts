import { and, asc, eq, gt, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, categories, transactions } from "@/db/schema";

// Re-exported so callers have one import for the whole feature.
export { describeCoverage } from "./coverage";

/**
 * What a credit card payment actually paid for.
 *
 * This is the gap the ledger leaves open by design. Charges are counted when
 * they happen and the payment is excluded, which is the only way to avoid
 * counting the same money twice — but it means a $1,299 payment leaving the
 * account in August appears nowhere, and the spending it settled is scattered
 * across July and August under a dozen categories. "Where did that $1,299 go"
 * has a real answer and the ledger was not able to give it.
 *
 * The attribution runs on the card side rather than the checking side, because
 * that is where the evidence is. Every payment appears twice — a debit leaving
 * checking, and a matching credit on the card statement — and only the card
 * copy sits on the account whose charges it settled. Matching the checking
 * copy would mean parsing a last-4 out of a description and hoping.
 *
 * A payment settles the charges since the previous payment. That is an
 * approximation of a statement cycle, not the cycle itself: a partial payment,
 * a carried balance or two payments in one month all break the tidy version.
 * So the coverage figure is reported rather than assumed, and a payment that
 * covers noticeably less than the charges before it is a carried balance
 * rather than a bug.
 */

export type CategoryShare = {
  slug: string;
  name: string;
  amountCents: number;
  count: number;
};

export type PaymentAttribution = {
  accountId: string;
  accountName: string;
  paymentId: string;
  paidOn: string;
  amountCents: number;
  /** The charge window this payment is taken to settle. */
  windowStart: string | null;
  windowEnd: string;
  chargeCount: number;
  chargesCents: number;
  /**
   * Payment as a share of the charges it covers. Around 1 means paid in full;
   * below means a balance was carried; above means an earlier balance was
   * being cleared too.
   */
  coverage: number | null;
  categories: CategoryShare[];
};

/**
 * Payments on a card account, oldest first, with the charges each one settled.
 *
 * Only cards: a payment is a credit on a card statement, and the same shape on
 * a checking account is a deposit.
 */
export async function attributeCardPayments(
  opts: { accountId?: string; since?: string } = {},
): Promise<PaymentAttribution[]> {
  const cardAccounts = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(
      opts.accountId
        ? and(eq(accounts.kind, "credit_card"), eq(accounts.id, opts.accountId))
        : eq(accounts.kind, "credit_card"),
    );

  const out: PaymentAttribution[] = [];

  for (const account of cardAccounts) {
    // Payments as they appear on the card: positive, and flagged because the
    // purchases they settle are the spending.
    const payments = await db
      .select({
        id: transactions.id,
        postedOn: transactions.postedOn,
        amountCents: transactions.amountCents,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.accountId, account.id),
          gt(transactions.amountCents, 0),
          eq(transactions.isTransfer, true),
        ),
      )
      .orderBy(asc(transactions.postedOn));

    let previousPaymentOn: string | null = null;

    for (const payment of payments) {
      if (opts.since && payment.postedOn < opts.since) {
        previousPaymentOn = payment.postedOn;
        continue;
      }

      /*
       * Charges strictly after the previous payment and up to this one. The
       * lower bound is exclusive so a charge posted on the same day as the
       * previous payment is not attributed to both.
       */
      const window = and(
        eq(transactions.accountId, account.id),
        sql`${transactions.amountCents} < 0`,
        eq(transactions.isTransfer, false),
        lte(transactions.postedOn, payment.postedOn),
        previousPaymentOn
          ? gt(transactions.postedOn, previousPaymentOn)
          : sql`true`,
      );

      const breakdown = await db
        .select({
          slug: categories.slug,
          name: categories.name,
          amount: sql<string>`COALESCE(SUM(-${transactions.amountCents}), 0)`,
          count: sql<string>`COUNT(*)`,
        })
        .from(transactions)
        .leftJoin(categories, eq(transactions.categoryId, categories.id))
        .where(window)
        .groupBy(categories.slug, categories.name)
        .orderBy(sql`3 DESC`);

      const categoriesShare: CategoryShare[] = breakdown.map((b) => ({
        slug: b.slug ?? "uncategorized",
        name: b.name ?? "Uncategorized",
        amountCents: Number(b.amount),
        count: Number(b.count),
      }));

      const chargesCents = categoriesShare.reduce(
        (a, c) => a + c.amountCents,
        0,
      );
      const chargeCount = categoriesShare.reduce((a, c) => a + c.count, 0);

      out.push({
        accountId: account.id,
        accountName: account.name,
        paymentId: payment.id,
        paidOn: payment.postedOn,
        amountCents: payment.amountCents,
        windowStart: previousPaymentOn,
        windowEnd: payment.postedOn,
        chargeCount,
        chargesCents,
        coverage: chargesCents > 0 ? payment.amountCents / chargesCents : null,
        categories: categoriesShare,
      });

      previousPaymentOn = payment.postedOn;
    }
  }

  return out.sort((a, b) => b.paidOn.localeCompare(a.paidOn));
}

/**
 * Charges on a card that no payment has settled yet — the balance you are
 * carrying, and the money that has been counted as spending but has not left
 * a bank account.
 */
export async function unsettledCharges(): Promise<
  Array<{ accountName: string; sinceOn: string | null; amountCents: number; count: number }>
> {
  const cards = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(eq(accounts.kind, "credit_card"));

  const out = [];
  for (const card of cards) {
    const [last] = await db
      .select({ postedOn: transactions.postedOn })
      .from(transactions)
      .where(
        and(
          eq(transactions.accountId, card.id),
          gt(transactions.amountCents, 0),
          eq(transactions.isTransfer, true),
        ),
      )
      .orderBy(sql`${transactions.postedOn} DESC`)
      .limit(1);

    const [after] = await db
      .select({
        total: sql<string>`COALESCE(SUM(-${transactions.amountCents}), 0)`,
        count: sql<string>`COUNT(*)`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.accountId, card.id),
          sql`${transactions.amountCents} < 0`,
          eq(transactions.isTransfer, false),
          last ? gt(transactions.postedOn, last.postedOn) : sql`true`,
        ),
      );

    if (Number(after?.count ?? 0) === 0) continue;
    out.push({
      accountName: card.name,
      sinceOn: last?.postedOn ?? null,
      amountCents: Number(after!.total),
      count: Number(after!.count),
    });
  }
  return out;
}

/** Cards with payments but no charges — the blind spot a payment stands in for. */
export async function unlinkedCards(): Promise<
  Array<{ accountName: string; paymentsCents: number; count: number }>
> {
  const rows = await db
    .select({
      name: accounts.name,
      charges: sql<string>`COUNT(*) FILTER (WHERE ${transactions.amountCents} < 0 AND NOT ${transactions.isTransfer})`,
      payments: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.amountCents} > 0 THEN ${transactions.amountCents} ELSE 0 END), 0)`,
      paymentCount: sql<string>`COUNT(*) FILTER (WHERE ${transactions.amountCents} > 0)`,
    })
    .from(accounts)
    .leftJoin(transactions, eq(transactions.accountId, accounts.id))
    .where(eq(accounts.kind, "credit_card"))
    .groupBy(accounts.name);

  return rows
    .filter((r) => Number(r.charges) === 0)
    .map((r) => ({
      accountName: r.name,
      paymentsCents: Number(r.payments),
      count: Number(r.paymentCount),
    }));
}
