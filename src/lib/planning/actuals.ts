import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { funds, transactions } from "@/db/schema";
import { monthBounds } from "@/lib/dates";
import { incomeMonth } from "@/lib/income/logic";
import { calculateActuals } from "./actuals-logic";
export async function monthlyActuals(month: string) {
  incomeMonth.parse(month);
  const { start, end } = monthBounds(month);
  const rows = await db
    .select({
      id: transactions.id,
      amountCents: transactions.amountCents,
      isTransfer: transactions.isTransfer,
      status: transactions.status,
      accountId: transactions.accountId,
      fundingAccountId: funds.fundingAccountId,
      fundKind: funds.kind,
    })
    .from(transactions)
    .leftJoin(funds, eq(transactions.fundId, funds.id))
    .where(
      and(gte(transactions.postedOn, start), lte(transactions.postedOn, end)),
    );
  return {
    ...calculateActuals(
      rows.map((row) => ({
        ...row,
        fundingSide:
          row.fundingAccountId !== null &&
          row.accountId === row.fundingAccountId,
      })),
    ),
    recordedCount: rows.length,
  };
}
