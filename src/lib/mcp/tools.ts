import { z } from "zod";
import { and, desc, eq, gte, ilike, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  transactions,
  categories,
  budgets,
  recurringSeries,
} from "@/db/schema";
import { logPurchase, resolveDate } from "@/lib/purchases";
import { learnFromCorrection } from "@/lib/classify/rules";
import { listPending, listReconciled } from "@/lib/reconcile";
import {
  monthSummary,
  budgetStatus,
  yearLedger,
  currentMonth,
  monthLabel,
  availableMonths,
  categoryTrends,
} from "@/lib/ledger";
import { listInsights, generateInsights } from "@/lib/insights";
import { formatCents } from "@/lib/money";

/**
 * The conversational surface of the ledger.
 *
 * Scope is read, log, and correct — deliberately no delete. A misheard
 * instruction should never be able to destroy a record, and every write here
 * is either additive or reversible from the web UI.
 *
 * Tool descriptions are written for the model that will call them: they say
 * *when* to reach for the tool, not just what it does.
 */

export type Tool = {
  name: string;
  description: string;
  inputSchema: z.ZodRawShape;
  /** True for tools that only read, surfaced to the client as a hint. */
  readOnly: boolean;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
};

// --- Helpers ----------------------------------------------------------------

async function categoryBySlug(slug: string) {
  const [row] = await db
    .select({ id: categories.id, name: categories.name, kind: categories.kind })
    .from(categories)
    .where(eq(categories.slug, slug))
    .limit(1);
  return row ?? null;
}

function money(cents: number) {
  return formatCents(cents);
}

// --- Tools ------------------------------------------------------------------

export const TOOLS: Tool[] = [
  {
    name: "log_purchase",
    description:
      "Record a purchase the person just told you about — 'I just bought coffee', 'I spent $40 on gas yesterday'. " +
      "Use this whenever they mention buying something, unless they are clearly asking a question about past spending instead. " +
      "The entry is marked pending and is automatically matched to the real charge when their statement is imported, so it is never counted twice. " +
      "If the ledger already clearly contains the charge, this reports that instead of adding a duplicate. " +
      "If it returns possible_duplicate, nothing was added — tell them what the existing charge is and ask whether it is the same purchase, then call again with confirm_new true if they say it is separate.",
    readOnly: false,
    inputSchema: {
      description: z
        .string()
        .describe(
          "What they bought or where, in their words: 'coffee at Blue Bottle', 'gas', 'dinner at Barolo'. Include the merchant when they name one — it is what lets the statement match later.",
        ),
      amount: z
        .number()
        .describe("Amount in dollars, always positive. Direction comes from `kind`."),
      date: z
        .string()
        .optional()
        .describe(
          "When it happened: 'today' (default), 'yesterday', '3 days ago', or an ISO date. If they did not say, omit it rather than guessing.",
        ),
      kind: z
        .enum(["expense", "income"])
        .optional()
        .describe("Defaults to expense. Use income for money they received."),
      category: z
        .string()
        .optional()
        .describe(
          "Category slug, only if they were explicit about it. Otherwise omit and it will be categorized automatically, which is usually better.",
        ),
      notes: z.string().optional().describe("Anything else worth keeping."),
      confirm_new: z
        .boolean()
        .optional()
        .describe(
          "Only set after a possible_duplicate result and the person confirming it is a genuinely separate purchase. Never set it pre-emptively.",
        ),
    },
    async handler(args) {
      const result = await logPurchase({
        description: String(args.description ?? ""),
        amount: Number(args.amount ?? 0),
        postedOn: args.date ? resolveDate(String(args.date)) : undefined,
        kind: (args.kind as "expense" | "income" | undefined) ?? "expense",
        categorySlug: args.category ? String(args.category) : null,
        notes: args.notes ? String(args.notes) : null,
        confirmNew: args.confirm_new === true,
      });
      return result;
    },
  },

  {
    name: "get_month_summary",
    description:
      "Income, spending, net and category breakdown for one month. Use for 'how am I doing this month', 'what did I spend on food in July', or any question about a single month's totals.",
    readOnly: true,
    inputSchema: {
      month: z
        .string()
        .optional()
        .describe("YYYY-MM. Defaults to the most recent month with data."),
    },
    async handler(args) {
      const months = await availableMonths();
      const month = String(args.month ?? months[0] ?? currentMonth());
      const s = await monthSummary(month);
      return {
        month: s.month,
        label: monthLabel(s.month),
        income: money(s.incomeCents),
        spending: money(s.spendCents),
        net: money(s.netCents),
        savings_rate:
          s.savingsRate === null ? null : `${(s.savingsRate * 100).toFixed(0)}%`,
        transactions: s.transactionCount,
        categories: s.byCategory
          .filter((c) => c.spendCents > 0)
          .map((c) => ({ name: c.name, slug: c.slug, spent: money(c.spendCents) })),
        top_merchants: s.topMerchants.map((m) => ({
          merchant: m.merchant,
          spent: money(m.spendCents),
          transactions: m.count,
        })),
      };
    },
  },

  {
    name: "search_transactions",
    description:
      "Find transactions by merchant, category or date range. Use for 'how much have I spent at Amazon', 'show me last week', or to check whether something was already recorded.",
    readOnly: true,
    inputSchema: {
      query: z.string().optional().describe("Text to match against merchant or description."),
      category: z.string().optional().describe("Category slug."),
      from: z.string().optional().describe("ISO start date, inclusive."),
      to: z.string().optional().describe("ISO end date, inclusive."),
      limit: z.number().optional().describe("Max rows, default 25, max 200."),
    },
    async handler(args) {
      const filters: SQL[] = [];
      if (args.query) {
        const needle = `%${String(args.query)}%`;
        const m = or(
          ilike(transactions.rawDescription, needle),
          ilike(transactions.merchant, needle),
        );
        if (m) filters.push(m);
      }
      if (args.category) filters.push(eq(categories.slug, String(args.category)));
      if (args.from) filters.push(gte(transactions.postedOn, String(args.from)));
      if (args.to) filters.push(lte(transactions.postedOn, String(args.to)));

      const limit = Math.min(200, Math.max(1, Number(args.limit ?? 25)));
      const where = filters.length > 0 ? and(...filters) : undefined;

      const rows = await db
        .select({
          id: transactions.id,
          date: transactions.postedOn,
          amountCents: transactions.amountCents,
          merchant: transactions.merchant,
          description: transactions.rawDescription,
          category: categories.name,
          categorySlug: categories.slug,
          status: transactions.status,
          entrySource: transactions.entrySource,
        })
        .from(transactions)
        .leftJoin(categories, eq(transactions.categoryId, categories.id))
        .where(where)
        .orderBy(desc(transactions.postedOn))
        .limit(limit);

      const totals = await db
        .select({
          count: sql<string>`count(*)`,
          net: sql<string>`COALESCE(SUM(${transactions.amountCents}), 0)`,
        })
        .from(transactions)
        .leftJoin(categories, eq(transactions.categoryId, categories.id))
        .where(where);

      return {
        matched: Number(totals[0]?.count ?? 0),
        net_total: money(Number(totals[0]?.net ?? 0)),
        showing: rows.length,
        transactions: rows.map((r) => ({
          id: r.id,
          date: r.date,
          amount: money(r.amountCents),
          merchant: r.merchant ?? r.description,
          category: r.category,
          category_slug: r.categorySlug,
          // Surfaced so the model can say "that one is still pending".
          pending: r.status === "pending",
          logged_by_you: r.entrySource === "manual",
        })),
      };
    },
  },

  {
    name: "get_budget_status",
    description:
      "Budgets versus actual spending for a month, including whether each is ahead of the calendar pace. Use for 'am I on track', 'how much is left for groceries'.",
    readOnly: true,
    inputSchema: {
      month: z.string().optional().describe("YYYY-MM. Defaults to the current month."),
    },
    async handler(args) {
      const month = String(args.month ?? currentMonth());
      const s = await budgetStatus(month);
      return {
        month: monthLabel(month),
        total_budgeted: money(s.totalBudgetCents),
        total_spent: money(s.totalSpentCents),
        budgets: s.lines.map((l) => ({
          category: l.name,
          slug: l.slug,
          budget: money(l.budgetCents),
          spent: money(l.spentCents),
          remaining: money(l.remainingCents),
          used_pct: `${Math.round(l.usedFraction * 100)}%`,
          status: l.status,
        })),
      };
    },
  },

  {
    name: "set_budget",
    description:
      "Set or change a monthly budget for a category. Takes effect from the current month; earlier months keep the target they had at the time. Use an amount of 0 to remove a budget.",
    readOnly: false,
    inputSchema: {
      category: z.string().describe("Category slug, e.g. 'groceries'."),
      amount: z.number().describe("Monthly target in dollars. 0 removes the budget."),
    },
    async handler(args) {
      const slug = String(args.category);
      const cat = await categoryBySlug(slug);
      if (!cat) throw new Error(`No category with slug "${slug}".`);

      const amountCents = Math.round(Math.abs(Number(args.amount ?? 0)) * 100);
      const effectiveFrom = `${currentMonth()}-01`;

      await db
        .update(budgets)
        .set({ effectiveTo: effectiveFrom })
        .where(
          and(eq(budgets.categoryId, cat.id), sql`${budgets.effectiveTo} IS NULL`),
        );

      if (amountCents > 0) {
        await db
          .insert(budgets)
          .values({ categoryId: cat.id, amountCents, effectiveFrom });
      }

      return {
        category: cat.name,
        budget: amountCents > 0 ? money(amountCents) : null,
        effective_from: effectiveFrom,
        summary:
          amountCents > 0
            ? `${cat.name} is now budgeted at ${money(amountCents)} a month.`
            : `Removed the budget for ${cat.name}.`,
      };
    },
  },

  {
    name: "recategorize",
    description:
      "Move a transaction to a different category. Use when they correct you — 'that was groceries, not restaurants'. " +
      "By default this also writes a rule so the same merchant is categorized correctly from now on, which is usually what they want.",
    readOnly: false,
    inputSchema: {
      transaction_id: z
        .string()
        .describe("The id from search_transactions or log_purchase."),
      category: z.string().describe("Category slug to move it to."),
      remember: z
        .boolean()
        .optional()
        .describe(
          "Default true. Set false only if they say this is a one-off and the merchant normally belongs elsewhere.",
        ),
    },
    async handler(args) {
      const id = String(args.transaction_id);
      const slug = String(args.category);
      const cat = await categoryBySlug(slug);
      if (!cat) throw new Error(`No category with slug "${slug}".`);

      const [row] = await db
        .select({
          rawDescription: transactions.rawDescription,
          merchant: transactions.merchant,
          amountCents: transactions.amountCents,
        })
        .from(transactions)
        .where(eq(transactions.id, id))
        .limit(1);
      if (!row) throw new Error(`No transaction with id "${id}".`);

      const isTransfer = cat.kind === "transfer";

      await db
        .update(transactions)
        .set({
          categoryId: cat.id,
          isTransfer,
          classificationSource: "manual",
          classificationConfidence: 1,
          classificationReason: "Set by you",
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, id));

      let learned = 0;
      if (args.remember !== false) {
        const result = await learnFromCorrection({
          rawDescription: row.rawDescription,
          categoryId: cat.id,
          merchantName: row.merchant,
          isTransfer,
          // Scopes the rule to the direction the correction was about.
          amountCents: row.amountCents,
        });
        learned = result?.applied ?? 0;
      }

      return {
        summary:
          `Moved ${row.merchant ?? row.rawDescription} to ${cat.name}.` +
          (args.remember !== false
            ? ` Saved a rule${learned > 1 ? `, which also corrected ${learned - 1} earlier transaction${learned - 1 === 1 ? "" : "s"}` : ""}.`
            : ""),
        category: cat.name,
        also_updated: Math.max(0, learned - 1),
      };
    },
  },

  {
    name: "list_categories",
    description:
      "All available categories with their slugs. Call this before recategorize or set_budget if you are unsure of the exact slug.",
    readOnly: true,
    inputSchema: {},
    async handler() {
      const rows = await db
        .select({
          slug: categories.slug,
          name: categories.name,
          kind: categories.kind,
          parentId: categories.parentId,
          id: categories.id,
        })
        .from(categories)
        .orderBy(categories.sortOrder);

      const parentIds = new Set(
        rows.map((r) => r.parentId).filter((v): v is string => Boolean(v)),
      );
      const names = new Map(rows.map((r) => [r.id, r.name]));

      return {
        categories: rows
          .filter((r) => !parentIds.has(r.id))
          .map((r) => ({
            slug: r.slug,
            name: r.name,
            kind: r.kind,
            group: r.parentId ? names.get(r.parentId) : null,
          })),
      };
    },
  },

  {
    name: "list_recurring",
    description:
      "Detected subscriptions and recurring bills, with annual cost and any price increases. Use for 'what am I subscribed to', 'what can I cancel', 'did anything go up in price'.",
    readOnly: true,
    inputSchema: {
      include_inactive: z
        .boolean()
        .optional()
        .describe("Include series that stopped billing or were ignored."),
    },
    async handler(args) {
      const rows = await db
        .select({
          id: recurringSeries.id,
          merchant: recurringSeries.merchant,
          cadence: recurringSeries.cadence,
          amountCents: recurringSeries.typicalAmountCents,
          annualCents: recurringSeries.annualizedCents,
          priceChangePct: recurringSeries.priceChangePct,
          status: recurringSeries.status,
          lastSeenOn: recurringSeries.lastSeenOn,
          nextExpectedOn: recurringSeries.nextExpectedOn,
          occurrences: recurringSeries.occurrences,
        })
        .from(recurringSeries)
        .orderBy(desc(recurringSeries.annualizedCents));

      const filtered = args.include_inactive
        ? rows
        : rows.filter((r) => r.status === "active");

      return {
        total_per_year: money(
          filtered
            .filter((r) => r.status === "active")
            .reduce((a, r) => a + r.annualCents, 0),
        ),
        subscriptions: filtered.map((r) => ({
          merchant: r.merchant,
          amount: money(r.amountCents),
          cadence: r.cadence,
          per_year: money(r.annualCents),
          price_change:
            r.priceChangePct === null || Math.abs(r.priceChangePct) < 1
              ? null
              : `${r.priceChangePct > 0 ? "+" : ""}${r.priceChangePct.toFixed(0)}% since the first charge`,
          status: r.status,
          last_charged: r.lastSeenOn,
          next_expected: r.nextExpectedOn,
          times_charged: r.occurrences,
        })),
      };
    },
  },

  {
    name: "ignore_recurring",
    description:
      "Stop treating a merchant as a recurring subscription. Use when they say something is not really a subscription.",
    readOnly: false,
    inputSchema: {
      merchant: z.string().describe("The merchant name as returned by list_recurring."),
    },
    async handler(args) {
      const merchant = String(args.merchant);
      const result = await db
        .update(recurringSeries)
        .set({ status: "paused" })
        .where(eq(recurringSeries.merchant, merchant))
        .returning({ id: recurringSeries.id });
      if (result.length === 0) throw new Error(`No recurring series for "${merchant}".`);
      return { summary: `${merchant} will no longer be tracked as recurring.` };
    },
  },

  {
    name: "get_year_summary",
    description:
      "Full-year totals with a month-by-month and category-by-category breakdown, plus the prior year for comparison. Use for 'how was this year', 'what did I spend on travel in 2026'.",
    readOnly: true,
    inputSchema: {
      year: z.number().optional().describe("Defaults to the most recent year with data."),
    },
    async handler(args) {
      const months = await availableMonths();
      const fallback = months[0] ? Number(months[0].slice(0, 4)) : new Date().getFullYear();
      const year = Number(args.year ?? fallback);
      const l = await yearLedger(year);

      return {
        year: l.year,
        income: money(l.totals.incomeCents),
        spending: money(l.totals.spendCents),
        net: money(l.totals.netCents),
        savings_rate:
          l.totals.savingsRate === null
            ? null
            : `${(l.totals.savingsRate * 100).toFixed(0)}%`,
        prior_year: l.priorYear
          ? {
              income: money(l.priorYear.incomeCents),
              spending: money(l.priorYear.spendCents),
              net: money(l.priorYear.netCents),
            }
          : null,
        by_month: l.months.map((m) => ({
          month: m.month,
          income: money(m.incomeCents),
          spending: money(m.spendCents),
        })),
        by_category: l.byCategory.slice(0, 25).map((c) => ({
          category: c.name,
          total: money(c.totalSpendCents),
          monthly_average: money(c.averageMonthlyCents),
        })),
      };
    },
  },

  {
    name: "get_insights",
    description:
      "The suggestion feed — price increases, categories drifting up, budgets slipping, each with a dollar figure. Use for open questions like 'what should I look at', 'where can I save money', 'anything I should know'.",
    readOnly: true,
    inputSchema: {
      refresh: z
        .boolean()
        .optional()
        .describe(
          "Recompute for the latest month before returning. Slower, but picks up transactions imported since the last run.",
        ),
    },
    async handler(args) {
      if (args.refresh) {
        const months = await availableMonths();
        await generateInsights(months[0] ?? currentMonth());
      }
      const rows = await listInsights();
      return {
        insights: rows.map((i) => ({
          title: i.title,
          detail: i.body,
          severity: i.severity,
          annual_impact: i.impactCents > 0 ? money(i.impactCents) : null,
          category: i.categoryName,
          month: i.periodMonth.slice(0, 7),
        })),
      };
    },
  },

  {
    name: "get_spending_trends",
    description:
      "How each category compares to its recent average. Use for 'am I spending more than usual', 'what changed this month'.",
    readOnly: true,
    inputSchema: {
      month: z.string().optional().describe("YYYY-MM. Defaults to the latest month."),
    },
    async handler(args) {
      const months = await availableMonths();
      const month = String(args.month ?? months[0] ?? currentMonth());
      const trends = await categoryTrends(month, 3);
      return {
        month: monthLabel(month),
        note:
          trends.length === 0
            ? "Not enough prior months in the ledger to compare against."
            : undefined,
        trends: trends.map((t) => ({
          category: t.name,
          this_month: money(t.currentCents),
          recent_average: money(t.averageCents),
          change:
            t.deltaPct === null
              ? "no prior spending"
              : `${t.deltaPct > 0 ? "+" : ""}${t.deltaPct.toFixed(0)}%`,
        })),
      };
    },
  },

  {
    name: "list_pending_purchases",
    description:
      "Purchases logged conversationally that no statement has confirmed yet. Use for 'what have I told you about', or to check before logging something twice.",
    readOnly: true,
    inputSchema: {},
    async handler() {
      const rows = await listPending();
      return {
        pending: rows.map((r) => ({
          id: r.id,
          date: r.postedOn,
          amount: money(r.amountCents),
          merchant: r.merchant ?? r.rawDescription,
          notes: r.notes,
        })),
        note: "These count toward the month already. When a statement containing them is imported they are matched to the real charge rather than added again.",
      };
    },
  },

  {
    name: "list_reconciled",
    description:
      "Purchases that were logged conversationally and later matched to a statement charge. Use to check the matching did the right thing, especially when an amount was adjusted for a tip.",
    readOnly: true,
    inputSchema: {},
    async handler() {
      const rows = await listReconciled();
      return {
        reconciled: rows.map((r) => ({
          id: r.id,
          date: r.postedOn,
          merchant: r.merchant ?? r.rawDescription,
          statement_amount: money(r.amountCents),
          you_logged:
            r.loggedAmountCents === null ? null : money(r.loggedAmountCents),
          matched_because: r.reconciliationNote,
        })),
      };
    },
  },
];

export function toolResult(value: unknown) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(value, null, 2) },
    ],
  };
}

export function toolError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  };
}
