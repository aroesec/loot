import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, categories, transactions } from "@/db/schema";
import { REVIEW_THRESHOLD } from "./classify/constants";

/**
 * Finding rows the ledger has probably got wrong.
 *
 * Unclassified rows announce themselves. Misclassified ones do not — they sit
 * in a total, look ordinary, and move a number the reader then makes a decision
 * on. A $4,500 mortgage payment filed as Restaurants does not error; it just
 * makes one category look alarming and another look fine.
 *
 * The checks below are all *disagreement* checks rather than judgement calls.
 * None of them decides what a transaction should be — each finds a place where
 * the ledger contradicts itself, which is a fact rather than an opinion and can
 * be surfaced without guessing.
 */

export type QualityIssue = {
  kind:
    | "unclassified"
    | "low-confidence"
    | "inconsistent-merchant"
    | "category-outlier"
    | "sign-mismatch"
    | "no-account";
  /** What is wrong, in one line. */
  summary: string;
  /** Why it matters — shown so the reader can judge whether to care. */
  detail: string;
  count: number;
  amountCents: number;
  /** A transactions-page filter that shows exactly these rows. */
  href: string;
};

/** Rows the classifier could not place at all. */
async function unclassified(): Promise<QualityIssue | null> {
  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`,
      total: sql<string>`COALESCE(SUM(ABS(${transactions.amountCents})), 0)`,
    })
    .from(transactions)
    .innerJoin(categories, eq(transactions.categoryId, categories.id))
    .where(
      and(
        sql`${categories.slug} IN ('uncategorized', 'biz-uncategorized')`,
        ne(transactions.classificationSource, "manual"),
      ),
    );

  if (!row || row.count === 0) return null;
  return {
    kind: "unclassified",
    summary: `${row.count} transaction${row.count === 1 ? "" : "s"} not categorized`,
    detail:
      "Counted in the totals but attributed to nothing, so every category reads low by this amount.",
    count: row.count,
    amountCents: Number(row.total),
    href: "/review/queue",
  };
}

/** Rows the model placed but was not confident about. */
async function lowConfidence(): Promise<QualityIssue | null> {
  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`,
      total: sql<string>`COALESCE(SUM(ABS(${transactions.amountCents})), 0)`,
    })
    .from(transactions)
    .where(
      and(
        sql`${transactions.classificationConfidence} < ${REVIEW_THRESHOLD}`,
        ne(transactions.classificationSource, "manual"),
      ),
    );

  if (!row || row.count === 0) return null;
  return {
    kind: "low-confidence",
    summary: `${row.count} categorized with low confidence`,
    detail:
      "The classifier said so itself. Confirming them also teaches a rule, so the same merchant is not guessed at twice.",
    count: row.count,
    amountCents: Number(row.total),
    href: "/review/queue",
  };
}

/**
 * One merchant filed under several categories.
 *
 * The strongest available signal for a *mis*classification, because it is the
 * ledger disagreeing with itself rather than anyone's opinion. Eight King
 * Soopers charges as Groceries and one as Restaurants means the one is almost
 * certainly wrong.
 *
 * A merchant that genuinely spans categories — Amazon, Target — will show up
 * here too, which is why this reports rather than corrects.
 */
async function inconsistentMerchants(): Promise<QualityIssue | null> {
  const rows = await db
    .select({
      merchant: transactions.merchant,
      categoryCount: sql<number>`count(DISTINCT ${transactions.categoryId})::int`,
      total: sql<number>`count(*)::int`,
      /** Rows outside the merchant's most common category. */
      minority: sql<number>`(
        count(*) - MAX(per_category.n)
      )::int`,
      amount: sql<string>`COALESCE(SUM(ABS(${transactions.amountCents})), 0)`,
    })
    .from(transactions)
    .leftJoin(
      sql`(
        SELECT merchant AS m, category_id AS c, COUNT(*) AS n
        FROM transactions
        WHERE merchant IS NOT NULL
        GROUP BY merchant, category_id
      ) AS per_category`,
      sql`per_category.m = ${transactions.merchant}`,
    )
    .where(
      and(
        sql`${transactions.merchant} IS NOT NULL`,
        eq(transactions.isTransfer, false),
      ),
    )
    .groupBy(transactions.merchant)
    .having(sql`count(DISTINCT ${transactions.categoryId}) > 1`);

  /*
   * Only merchants where the split is lopsided. An even spread across two
   * categories is a merchant that genuinely does two things; a single row
   * against a dozen is a mistake.
   */
  const suspect = rows.filter(
    (r) => r.minority > 0 && r.minority / r.total <= 0.25,
  );
  if (suspect.length === 0) return null;

  const count = suspect.reduce((a, r) => a + r.minority, 0);
  return {
    kind: "inconsistent-merchant",
    summary: `${count} row${count === 1 ? "" : "s"} disagree with the same merchant elsewhere`,
    detail:
      `${suspect
        .slice(0, 3)
        .map((r) => r.merchant)
        .join(", ")}${suspect.length > 3 ? ` and ${suspect.length - 3} more` : ""} ` +
      "are filed under more than one category, with most rows agreeing and a few not.",
    count,
    amountCents: suspect.reduce((a, r) => a + Number(r.amount), 0),
    href: "/transactions",
  };
}

/**
 * A transaction far larger than others in its category.
 *
 * Not proof of anything — a genuinely large grocery shop exists — but a $4,500
 * row in a category whose others are under $100 is worth a glance, and this is
 * the shape a misfiled mortgage or card payment takes.
 */
async function categoryOutliers(): Promise<QualityIssue | null> {
  const rows = await db
    .select({
      id: transactions.id,
      amount: sql<number>`ABS(${transactions.amountCents})::int`,
      categoryName: categories.name,
      median: sql<number>`(
        SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ABS(t2.amount_cents))
        FROM transactions t2
        WHERE t2.category_id = ${transactions.categoryId}
          AND NOT t2.is_transfer
      )::int`,
    })
    .from(transactions)
    .innerJoin(categories, eq(transactions.categoryId, categories.id))
    .where(
      and(
        eq(transactions.isTransfer, false),
        ne(transactions.classificationSource, "manual"),
        sql`ABS(${transactions.amountCents}) > 50000`,
      ),
    );

  // Twenty times the category's median, and material in absolute terms.
  const outliers = rows.filter((r) => r.median > 0 && r.amount > r.median * 20);
  if (outliers.length === 0) return null;

  return {
    kind: "category-outlier",
    summary: `${outliers.length} unusually large for their category`,
    detail:
      "Twenty times the median of everything else filed there. Sometimes real, and sometimes a large payment that landed in the wrong place.",
    count: outliers.length,
    amountCents: outliers.reduce((a, r) => a + r.amount, 0),
    href: "/transactions",
  };
}

/**
 * Money arriving in an expense category, or leaving an income one.
 *
 * Almost always a real mistake rather than a refund: the classifier is told
 * that sign is strong evidence, so disagreeing with it usually means the
 * category was chosen from the description alone.
 */
async function signMismatches(): Promise<QualityIssue | null> {
  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`,
      total: sql<string>`COALESCE(SUM(ABS(${transactions.amountCents})), 0)`,
    })
    .from(transactions)
    .innerJoin(categories, eq(transactions.categoryId, categories.id))
    .where(
      and(
        eq(transactions.isTransfer, false),
        ne(transactions.classificationSource, "manual"),
        sql`(
          (${categories.kind} = 'income' AND ${transactions.amountCents} < 0)
          OR (${categories.kind} = 'expense' AND ${transactions.amountCents} > 0
              AND ${categories.slug} NOT IN ('refunds', 'refunds-issued'))
        )`,
      ),
    );

  if (!row || row.count === 0) return null;
  return {
    kind: "sign-mismatch",
    summary: `${row.count} where the direction contradicts the category`,
    detail:
      "Money arriving in an expense category, or leaving an income one. Usually the category was chosen from the description without reading the sign.",
    count: row.count,
    amountCents: Number(row.total),
    href: "/transactions",
  };
}

/** Rows with no account, which share one dedupe namespace and can collide. */
async function withoutAccount(): Promise<QualityIssue | null> {
  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`,
      total: sql<string>`COALESCE(SUM(ABS(${transactions.amountCents})), 0)`,
    })
    .from(transactions)
    .where(isNull(transactions.accountId));

  if (!row || row.count === 0) return null;
  return {
    kind: "no-account",
    summary: `${row.count} not attached to an account`,
    detail:
      "The dedupe fingerprint includes the account, so these share one namespace with each other — an identical charge on two accounts can silently drop one.",
    count: row.count,
    amountCents: Number(row.total),
    href: "/transactions",
  };
}

/**
 * Everything currently wrong or suspicious, worst first by amount.
 *
 * Ordered by money rather than count: fifty coffees miscategorized matter less
 * than one misfiled mortgage payment, and it is the second that moves a
 * decision.
 */
export async function qualityIssues(): Promise<QualityIssue[]> {
  const found = await Promise.all([
    unclassified(),
    lowConfidence(),
    inconsistentMerchants(),
    categoryOutliers(),
    signMismatches(),
    withoutAccount(),
  ]);

  return found
    .filter((i): i is QualityIssue => i !== null)
    .sort((a, b) => b.amountCents - a.amountCents);
}

export type ProfileGap = {
  field: string;
  prompt: string;
  why: string;
  href: string;
};

/**
 * Facts the app needs from the user and does not have.
 *
 * Surfaced continuously rather than once at setup, because the cost of a
 * missing answer is silent and permanent: with household size unset, every
 * benchmark comparison is computed for a single person and a family is told
 * they overspend on everything. A wrong reference point is worse than none,
 * and nothing about the resulting page looks broken.
 */
export async function profileGaps(): Promise<ProfileGap[]> {
  const { household, ledgerMode } = await import("./mode");
  const [home, mode] = await Promise.all([household(), ledgerMode()]);
  const gaps: ProfileGap[] = [];

  /*
   * Household size and state only mean something for a personal ledger: they
   * scale the comparison against published household averages, and a business
   * has no household. Asking anyway put "How many people are in your
   * household?" above the P&L on every page of a business deployment.
   */
  const comparesAgainstHouseholds = mode === "personal";

  const [defaults] = await db
    .select({
      adults: sql<number>`count(*) FILTER (WHERE household_adults = 1)::int`,
      region: sql<number>`count(*) FILTER (WHERE region IS NULL)::int`,
    })
    .from(sql`settings`);

  /*
   * One adult is the default as well as a legitimate answer, so it cannot be
   * told from "never set" — asked once here rather than assumed, and dismissed
   * by confirming it.
   */
  if (
    comparesAgainstHouseholds &&
    (defaults?.adults ?? 0) > 0 &&
    home.adults === 1 &&
    home.children === 0
  ) {
    gaps.push({
      field: "household",
      prompt: "How many people are in your household?",
      why: "Every comparison with published averages is scaled per person. Left at one, a family is told it overspends on everything.",
      href: "/settings",
    });
  }

  if (comparesAgainstHouseholds && home.country === "US" && !home.region) {
    gaps.push({
      field: "region",
      prompt: "Which state?",
      why: "Adjusts national averages for local prices — the single largest correction available, and worth up to 15% either way.",
      href: "/settings",
    });
  }

  const [balances] = await db
    .select({ missing: sql<number>`count(*)::int` })
    .from(accounts)
    .where(and(isNull(accounts.balanceCents), isNull(accounts.archivedAt)));

  if ((balances?.missing ?? 0) > 0) {
    gaps.push({
      field: "balances",
      prompt: `${balances!.missing} account${balances!.missing === 1 ? " has" : "s have"} no balance`,
      why: "The cushion is a balance, not a flow. Without one, how long your money would last cannot be answered at all.",
      href: "/settings",
    });
  }

  return gaps;
}
