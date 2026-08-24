import { z } from "zod";
import { and, eq, desc, ne } from "drizzle-orm";
import { db } from "@/db";
import { insights, recurringSeries, categories } from "@/db/schema";
import type { NewInsight } from "@/db/schema";
import { aiProvider } from "@/lib/ai";
import { formatCents } from "@/lib/money";
import {
  monthSummary,
  categoryTrends,
  budgetStatus,
  monthLabel,
  type MonthKey,
} from "./ledger";
import { sha256Hex } from "./classify/normalize";

/**
 * The insight feed is built in two stages.
 *
 * Stage one computes facts from the ledger — price hikes, budget overruns,
 * trend swings. These are deterministic, always available, and each carries
 * the numbers it was derived from.
 *
 * Stage two hands those facts to Claude to write the suggestions. The model
 * never sees raw transactions and is never asked to do arithmetic; it works
 * from figures already computed here. That's what keeps the dollar amounts in
 * the feed trustworthy.
 */

export type Evidence = {
  month: MonthKey;
  monthLabel: string;
  incomeCents: number;
  spendCents: number;
  netCents: number;
  savingsRate: number | null;
  topCategories: Array<{ name: string; slug: string; spendCents: number }>;
  trends: Array<{
    name: string;
    slug: string;
    currentCents: number;
    averageCents: number;
    deltaPct: number | null;
  }>;
  budgets: Array<{
    name: string;
    slug: string;
    budgetCents: number;
    spentCents: number;
    status: string;
  }>;
  subscriptions: Array<{
    merchant: string;
    cadence: string;
    amountCents: number;
    annualizedCents: number;
    priceChangePct: number | null;
    status: string;
    lastSeenOn: string;
    occurrences: number;
  }>;
  topMerchants: Array<{ merchant: string; spendCents: number; count: number }>;
};

export async function gatherEvidence(month: MonthKey): Promise<Evidence> {
  const [summary, trends, budgetsNow, subs] = await Promise.all([
    monthSummary(month),
    categoryTrends(month, 3),
    budgetStatus(month),
    db
      .select({
        merchant: recurringSeries.merchant,
        cadence: recurringSeries.cadence,
        typicalAmountCents: recurringSeries.typicalAmountCents,
        annualizedCents: recurringSeries.annualizedCents,
        priceChangePct: recurringSeries.priceChangePct,
        status: recurringSeries.status,
        lastSeenOn: recurringSeries.lastSeenOn,
        occurrences: recurringSeries.occurrences,
      })
      .from(recurringSeries)
      .orderBy(desc(recurringSeries.annualizedCents))
      .limit(40),
  ]);

  return {
    month,
    monthLabel: monthLabel(month),
    incomeCents: summary.incomeCents,
    spendCents: summary.spendCents,
    netCents: summary.netCents,
    savingsRate: summary.savingsRate,
    topCategories: summary.byCategory
      .filter((c) => c.spendCents > 0)
      .slice(0, 12)
      .map((c) => ({ name: c.name, slug: c.slug, spendCents: c.spendCents })),
    trends: trends.slice(0, 10).map((t) => ({
      name: t.name,
      slug: t.slug,
      currentCents: t.currentCents,
      averageCents: t.averageCents,
      deltaPct: t.deltaPct,
    })),
    budgets: budgetsNow.lines.map((b) => ({
      name: b.name,
      slug: b.slug,
      budgetCents: b.budgetCents,
      spentCents: b.spentCents,
      status: b.status,
    })),
    subscriptions: subs.map((s) => ({
      merchant: s.merchant,
      cadence: s.cadence,
      amountCents: s.typicalAmountCents,
      annualizedCents: s.annualizedCents,
      priceChangePct: s.priceChangePct,
      status: s.status,
      lastSeenOn: s.lastSeenOn,
      occurrences: s.occurrences,
    })),
    topMerchants: summary.topMerchants,
  };
}

// ---------------------------------------------------------------------------
// Deterministic insights — always produced, no model required
// ---------------------------------------------------------------------------

export type DraftInsight = {
  kind: string;
  title: string;
  body: string;
  severity: "info" | "opportunity" | "warning";
  impactCents: number;
  categorySlug?: string | null;
  evidence: Record<string, unknown>;
};

export function deterministicInsights(ev: Evidence): DraftInsight[] {
  const out: DraftInsight[] = [];

  // Subscription price increases.
  for (const s of ev.subscriptions) {
    if (s.status !== "active") continue;
    if (s.priceChangePct === null || s.priceChangePct < 8) continue;
    const extraPerYear = Math.round(
      s.annualizedCents * (s.priceChangePct / (100 + s.priceChangePct)),
    );
    out.push({
      kind: "price_increase",
      title: `${s.merchant} costs ${s.priceChangePct.toFixed(0)}% more than when it started`,
      body: `${s.merchant} began at a lower rate and now bills ${formatCents(s.amountCents)} ${s.cadence}. At the current price that is ${formatCents(s.annualizedCents)} a year, about ${formatCents(extraPerYear)} more than the original rate.`,
      severity: "warning",
      impactCents: extraPerYear,
      evidence: { merchant: s.merchant, priceChangePct: s.priceChangePct },
    });
  }

  // Subscriptions that appear to have lapsed but are still billing, and ones
  // that stopped — both are worth surfacing.
  for (const s of ev.subscriptions) {
    if (s.status !== "ended") continue;
    if (s.occurrences < 4) continue;
    out.push({
      kind: "subscription_ended",
      title: `${s.merchant} stopped billing`,
      body: `${s.merchant} charged ${formatCents(s.amountCents)} ${s.cadence} for ${s.occurrences} periods, most recently on ${s.lastSeenOn}. If that was intentional you are saving ${formatCents(s.annualizedCents)} a year; if not, the payment method may have failed.`,
      severity: "info",
      impactCents: s.annualizedCents,
      evidence: { merchant: s.merchant, lastSeenOn: s.lastSeenOn },
    });
  }

  // Budgets already blown.
  for (const b of ev.budgets) {
    if (b.status !== "over") continue;
    const over = b.spentCents - b.budgetCents;
    out.push({
      kind: "budget_exceeded",
      title: `${b.name} is over budget by ${formatCents(over)}`,
      body: `You budgeted ${formatCents(b.budgetCents)} for ${b.name} in ${ev.monthLabel} and have spent ${formatCents(b.spentCents)}.`,
      severity: "warning",
      impactCents: over * 12,
      categorySlug: b.slug,
      evidence: { budgetCents: b.budgetCents, spentCents: b.spentCents },
    });
  }

  // Large trend swings.
  for (const t of ev.trends) {
    if (t.deltaPct === null || t.averageCents === 0) continue;
    if (t.deltaPct < 40 || t.currentCents - t.averageCents < 5000) continue;
    out.push({
      kind: "spending_spike",
      title: `${t.name} is up ${t.deltaPct.toFixed(0)}% against your recent average`,
      body: `${t.name} came to ${formatCents(t.currentCents)} in ${ev.monthLabel}, against a recent average of ${formatCents(t.averageCents)}.`,
      severity: "opportunity",
      impactCents: (t.currentCents - t.averageCents) * 12,
      categorySlug: t.slug,
      evidence: {
        currentCents: t.currentCents,
        averageCents: t.averageCents,
      },
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// LLM insights
// ---------------------------------------------------------------------------

const llmSchema = z.object({
  insights: z.array(
    z.object({
      kind: z.string(),
      title: z.string(),
      body: z.string(),
      severity: z.enum(["info", "opportunity", "warning"]),
      estimated_annual_impact_dollars: z.number(),
      category_slug: z.string().nullable(),
    }),
  ),
});

const INSIGHT_SYSTEM = `You are reviewing one month of someone's categorized spending and writing the short list of things actually worth their attention.

<inputs>
Every figure you receive has already been computed from their ledger, and all amounts are in dollars. Use the numbers as given — do not recompute totals, re-derive percentages, or infer amounts that are not in the data. If you state a number, it must be one you were handed or a direct restatement of one.

A prior average is taken only over months the ledger actually covers. If a category shows a prior average of 0, it means there was genuinely no spending there in those months, not that data is missing.
</inputs>

<what_to_write>
Aim for three to six insights. Fewer is fine when the month is unremarkable — a short honest list is more useful than a padded one, and a person who gets five filler items stops reading the feed.

Each insight needs a specific number and a specific action. "You spent a lot on food" is useless. "Food delivery came to $340 across 18 orders, against $190 the month before — the gap is about the cost of one order a week" gives them something to decide about.

Prefer things that are actionable and recurring over one-off noise. A subscription that quietly went up 20% matters more than a single large purchase they already know about. A category drifting up three months running matters more than one bad week.

Skip anything the person obviously already knows. Rent going out on the first is not an insight.
</what_to_write>

<estimating_impact>
estimated_annual_impact_dollars is what changing this behavior would be worth over a year. For a subscription, that's its annual cost. For a category running above its usual level, that's roughly twelve times the monthly excess.

This drives the ordering of the feed, so an honest estimate matters more than an impressive one. Use 0 when an item is informational and has no dollar figure attached.
</estimating_impact>

<tone>
Write like a friend who happens to be good with money: direct, concrete, no lecturing. State what happened, what it costs, and what they could do.

Do not moralize about spending. Someone who spends on eating out is not making a mistake — they may be making a choice. Give them the number and let them decide.

Skip openers like "Great news!" or "I noticed that". Lead with the fact.
</tone>

<category_slug>
Set category_slug to the slug of the category the insight is about, taken from the data you were given. Use null for insights that span categories.
</category_slug>`;

export async function llmInsights(ev: Evidence): Promise<DraftInsight[]> {
  const provider = aiProvider();
  // No provider is a supported configuration: the deterministic insights that
  // ran before this point stand on their own.
  if (!provider) return [];

  /*
   * Everything is converted to dollars before it reaches the model. Sending
   * cents and asking for the conversion in the prompt worked most of the time,
   * but "most of the time" still leaked a raw "$12345" into a user-facing
   * sentence. Doing the arithmetic here removes the failure mode instead of
   * relying on the model to avoid it.
   */
  const d = (cents: number) => Number((cents / 100).toFixed(2));

  const payload = {
    month: ev.monthLabel,
    income_dollars: d(ev.incomeCents),
    spend_dollars: d(ev.spendCents),
    net_dollars: d(ev.netCents),
    savings_rate:
      ev.savingsRate === null ? null : Number(ev.savingsRate.toFixed(3)),
    top_categories: ev.topCategories.map((c) => ({
      name: c.name,
      slug: c.slug,
      spend_dollars: d(c.spendCents),
    })),
    category_trends_vs_prior_months: ev.trends.map((t) => ({
      name: t.name,
      slug: t.slug,
      this_month_dollars: d(t.currentCents),
      prior_average_dollars: d(t.averageCents),
      change_pct: t.deltaPct === null ? null : Number(t.deltaPct.toFixed(1)),
    })),
    budgets: ev.budgets.map((b) => ({
      name: b.name,
      slug: b.slug,
      budget_dollars: d(b.budgetCents),
      spent_dollars: d(b.spentCents),
      status: b.status,
    })),
    recurring_subscriptions: ev.subscriptions.map((s) => ({
      merchant: s.merchant,
      cadence: s.cadence,
      amount_dollars: d(s.amountCents),
      annual_cost_dollars: d(s.annualizedCents),
      price_change_pct:
        s.priceChangePct === null ? null : Number(s.priceChangePct.toFixed(1)),
      status: s.status,
      last_seen_on: s.lastSeenOn,
      times_charged: s.occurrences,
    })),
    top_merchants: ev.topMerchants.map((m) => ({
      merchant: m.merchant,
      spend_dollars: d(m.spendCents),
      transactions: m.count,
    })),
  };

  const result = await provider.complete({
    system: INSIGHT_SYSTEM,
    maxTokens: 16000,
    effort: "medium",
    cacheSystem: true,
    jsonSchema: {
      name: "insights",
      schema: {
          type: "object",
          properties: {
            insights: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  kind: { type: "string" },
                  title: { type: "string" },
                  body: { type: "string" },
                  severity: {
                    type: "string",
                    enum: ["info", "opportunity", "warning"],
                  },
                  estimated_annual_impact_dollars: { type: "number" },
                  category_slug: { type: ["string", "null"] },
                },
                required: [
                  "kind",
                  "title",
                  "body",
                  "severity",
                  "estimated_annual_impact_dollars",
                  "category_slug",
                ],
                additionalProperties: false,
              },
            },
          },
        required: ["insights"],
        additionalProperties: false,
      },
    },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Here is the data for ${ev.monthLabel}:\n\n${JSON.stringify(payload, null, 2)}`,
          },
        ],
      },
    ],
  });

  if (result.refused) return [];

  try {
    const parsed = llmSchema.parse(JSON.parse(result.text));
    return parsed.insights.map((i) => ({
      kind: i.kind,
      title: i.title,
      body: i.body,
      severity: i.severity,
      impactCents: Math.round(i.estimated_annual_impact_dollars * 100),
      categorySlug: i.category_slug,
      evidence: { source: "llm", model: provider.model, usage: result.usage },
    }));
  } catch (err) {
    console.error("could not parse insight response", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Generation + persistence
// ---------------------------------------------------------------------------

async function fingerprint(month: MonthKey, kind: string, title: string) {
  // Titles carry the specific figure, so a changed amount produces a new
  // insight rather than silently overwriting the old one.
  return sha256Hex(new TextEncoder().encode(`${month}|${kind}|${title}`));
}

export async function generateInsights(
  month: MonthKey,
  opts: { useLlm?: boolean } = {},
): Promise<{ created: number; total: number; usedLlm: boolean }> {
  const ev = await gatherEvidence(month);

  let drafts = deterministicInsights(ev);
  let usedLlm = false;

  if (opts.useLlm !== false) {
    try {
      const fromModel = await llmInsights(ev);
      if (fromModel.length > 0) {
        usedLlm = true;

        /*
         * The deterministic pass and the model often notice the same thing —
         * a category spike shows up as a bare "X is up 40%" alongside a fuller
         * write-up of the same movement. Two entries for one finding makes the
         * feed feel padded, so where the model covered a category, its version
         * wins: same fact, more context.
         *
         * Only trend spikes are suppressed. Price increases and budget
         * overruns are kept regardless, since those carry figures the model was
         * given rather than derived, and losing one would lose the alert.
         */
        const covered = new Set(
          fromModel
            .map((i) => i.categorySlug)
            .filter((s): s is string => Boolean(s)),
        );
        drafts = drafts.filter(
          (d) =>
            d.kind !== "spending_spike" ||
            !d.categorySlug ||
            !covered.has(d.categorySlug),
        );

        drafts.push(...fromModel);
      }
    } catch (err) {
      console.error("LLM insight generation failed", err);
    }
  }

  const slugMap = new Map(
    (
      await db
        .select({ id: categories.id, slug: categories.slug })
        .from(categories)
    ).map((r) => [r.slug, r.id]),
  );

  const monthStart = `${month}-01`;
  let created = 0;

  for (const d of drafts) {
    const fp = await fingerprint(month, d.kind, d.title);
    const row: NewInsight = {
      kind: d.kind,
      title: d.title,
      body: d.body,
      severity: d.severity,
      impactCents: Math.max(0, d.impactCents),
      categoryId: d.categorySlug ? (slugMap.get(d.categorySlug) ?? null) : null,
      periodMonth: monthStart,
      evidence: d.evidence,
      fingerprint: fp,
    };
    const inserted = await db
      .insert(insights)
      .values(row)
      // A repeat run must not resurrect something already dismissed.
      .onConflictDoNothing({ target: insights.fingerprint })
      .returning({ id: insights.id });
    if (inserted.length > 0) created += 1;
  }

  return { created, total: drafts.length, usedLlm };
}

export async function listInsights(opts: { includeDismissed?: boolean } = {}) {
  const where = opts.includeDismissed
    ? undefined
    : ne(insights.status, "dismissed");

  return db
    .select({
      id: insights.id,
      kind: insights.kind,
      title: insights.title,
      body: insights.body,
      severity: insights.severity,
      impactCents: insights.impactCents,
      periodMonth: insights.periodMonth,
      status: insights.status,
      categoryName: categories.name,
      categorySlug: categories.slug,
      createdAt: insights.createdAt,
    })
    .from(insights)
    .leftJoin(categories, eq(insights.categoryId, categories.id))
    .where(where)
    .orderBy(desc(insights.impactCents), desc(insights.createdAt))
    .limit(50);
}

export async function setInsightStatus(
  id: string,
  status: "new" | "read" | "dismissed" | "actioned",
) {
  await db.update(insights).set({ status }).where(eq(insights.id, id));
}
