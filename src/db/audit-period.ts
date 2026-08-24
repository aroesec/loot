import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "./index";
import { accounts, categories, transactions } from "./schema";
import { monthBounds, type MonthKey } from "@/lib/dates";
import { monthSummary } from "@/lib/ledger";
import { formatCents } from "@/lib/money";

/**
 * Prove that a period's headline number accounts for every transaction in it.
 *
 * The reason this exists: the August total moved from $5,000 to $23,700 over
 * the course of fixing real bugs, and "the number changed again" is
 * indistinguishable from "the number is wrong" without a way to check. This
 * reconciles the same period four different ways and shows every row that is
 * deliberately excluded, so a total can be believed rather than trusted.
 *
 * The four angles are independent on purpose. `monthSummary` groups by
 * category and sums; the checks below sum the raw rows, sum per account, and
 * count. If a row were being dropped by a join or double-counted by a group,
 * these would disagree.
 */
export async function auditPeriod(month: MonthKey): Promise<boolean> {
  const { start, end } = monthBounds(month);

  console.log(`\n=== ${month}  (${start} .. ${end}) ===\n`);

  // Angle 1: the app's own answer, grouped by category.
  const summary = await monthSummary(month);

  // Angle 2: raw rows, no joins, no grouping.
  const [raw] = await db
    .select({
      spend: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.amountCents} < 0 THEN -${transactions.amountCents} ELSE 0 END), 0)`,
      income: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.amountCents} > 0 THEN ${transactions.amountCents} ELSE 0 END), 0)`,
      counted: sql<string>`COUNT(*)`,
    })
    .from(transactions)
    .where(
      and(
        gte(transactions.postedOn, start),
        lte(transactions.postedOn, end),
        eq(transactions.isTransfer, false),
      ),
    );

  // Angle 3: per account, then summed here rather than in SQL.
  const perAccount = await db
    .select({
      name: accounts.name,
      last4: accounts.last4,
      spend: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.amountCents} < 0 AND NOT ${transactions.isTransfer} THEN -${transactions.amountCents} ELSE 0 END), 0)`,
      income: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.amountCents} > 0 AND NOT ${transactions.isTransfer} THEN ${transactions.amountCents} ELSE 0 END), 0)`,
      excluded: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.isTransfer} THEN ABS(${transactions.amountCents}) ELSE 0 END), 0)`,
      rows: sql<string>`COUNT(*)`,
    })
    .from(transactions)
    .leftJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(
      and(gte(transactions.postedOn, start), lte(transactions.postedOn, end)),
    )
    .groupBy(accounts.name, accounts.last4)
    .orderBy(sql`3 DESC`);

  console.log("Per account");
  let sumSpend = 0;
  let sumIncome = 0;
  for (const a of perAccount) {
    sumSpend += Number(a.spend);
    sumIncome += Number(a.income);
    console.log(
      `  ${(a.name ?? "unassigned").padEnd(24)} ••${(a.last4 ?? "—").padEnd(5)} ` +
        `${a.rows.padStart(4)} rows   spend ${formatCents(Number(a.spend)).padStart(11)}` +
        `   in ${formatCents(Number(a.income)).padStart(11)}` +
        `   excluded ${formatCents(Number(a.excluded)).padStart(10)}`,
    );
  }

  // Angle 4: a plain count of everything in the window, excluded or not.
  const [all] = await db
    .select({ total: sql<string>`COUNT(*)` })
    .from(transactions)
    .where(
      and(gte(transactions.postedOn, start), lte(transactions.postedOn, end)),
    );

  console.log("\nReconciliation");
  const checks: Array<[string, number, number]> = [
    ["spend: summary vs raw rows", summary.spendCents, Number(raw!.spend)],
    ["spend: summary vs per-account", summary.spendCents, sumSpend],
    ["income: summary vs raw rows", summary.incomeCents, Number(raw!.income)],
    ["income: summary vs per-account", summary.incomeCents, sumIncome],
    ["counted rows", summary.transactionCount, Number(raw!.counted)],
  ];

  let ok = true;
  for (const [label, a, b] of checks) {
    const match = a === b;
    if (!match) ok = false;
    console.log(
      `  ${match ? "ok  " : "FAIL"} ${label.padEnd(32)} ${a} vs ${b}`,
    );
  }

  /*
   * Every excluded row, itemized. An exclusion is only correct when the same
   * money is counted elsewhere in the ledger, and that claim should be
   * readable rather than asserted.
   */
  const excluded = await db
    .select({
      postedOn: transactions.postedOn,
      amountCents: transactions.amountCents,
      category: categories.name,
      account: accounts.name,
      reason: transactions.classificationReason,
      description: transactions.rawDescription,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .leftJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(
      and(
        gte(transactions.postedOn, start),
        lte(transactions.postedOn, end),
        eq(transactions.isTransfer, true),
      ),
    )
    .orderBy(transactions.amountCents);

  const totalRows = Number(all!.total);
  console.log(
    `\nExcluded from totals: ${excluded.length} of ${totalRows} rows in the window`,
  );
  for (const e of excluded) {
    console.log(
      `  ${e.postedOn} ${formatCents(e.amountCents, { signed: true }).padStart(12)}  ` +
        `${(e.category ?? "—").padEnd(22)} ${e.description.slice(0, 38)}`,
    );
  }

  console.log(
    `\n${summary.transactionCount} counted + ${excluded.length} excluded = ` +
      `${summary.transactionCount + excluded.length} (window holds ${totalRows})`,
  );
  if (summary.transactionCount + excluded.length !== totalRows) {
    console.log("  FAIL — rows in the window are unaccounted for");
    ok = false;
  }

  console.log(
    `\n${ok ? "PASS" : "FAIL"}  spend ${formatCents(summary.spendCents)}  ` +
      `income ${formatCents(summary.incomeCents)}  ` +
      `net ${formatCents(summary.netCents, { signed: true })}`,
  );
  return ok;
}

if (process.argv[1]?.endsWith("audit-period.ts")) {
  const arg = process.argv[2];
  (async () => {
    const months = arg
      ? [arg]
      : (
          await db
            .selectDistinct({
              m: sql<string>`to_char(${transactions.postedOn}, 'YYYY-MM')`,
            })
            .from(transactions)
            .orderBy(sql`1 DESC`)
        ).map((r) => r.m);

    let allOk = true;
    for (const m of months) if (!(await auditPeriod(m))) allOk = false;
    process.exit(allOk ? 0 : 1);
  })().catch((err) => {
    console.error("audit failed", err);
    process.exit(1);
  });
}
