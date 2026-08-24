import { z } from "zod";
import { requireAi, type Usage } from "@/lib/ai";
import { formatCents } from "@/lib/money";

export type ClassifiableTransaction = {
  id: string;
  postedOn: string;
  amountCents: number;
  rawDescription: string;
  /** Helps disambiguate: a charge on a credit card is rarely a bill payment. */
  accountKind?: string | null;
  /**
   * Merchant already settled by a merchant-only rule — the payment rail. Told
   * to the model so it names the rail consistently and spends its judgment on
   * the category instead.
   */
  merchantHint?: string | null;
};

export type CategoryOption = {
  slug: string;
  name: string;
  kind: "expense" | "income" | "transfer";
  parentName?: string | null;
  hint?: string | null;
};

export type LlmClassification = {
  id: string;
  categorySlug: string;
  merchant: string | null;
  confidence: number;
  reason: string;
  isTransfer: boolean;
};

export type LlmBatchResult = {
  classifications: LlmClassification[];
  usage: Usage;
  ms: number;
};

/**
 * Batching keeps the cached taxonomy prefix amortized across many rows. 40 is
 * a balance: large enough that the system prompt is a small share of the call,
 * small enough that one bad row can't spoil a large batch.
 */
export const BATCH_SIZE = 40;

const responseSchema = z.object({
  classifications: z.array(
    z.object({
      id: z.string(),
      category: z.string(),
      merchant: z.string().nullable().optional(),
      confidence: z.number(),
      reason: z.string(),
      is_transfer: z.boolean(),
    }),
  ),
});

/**
 * What a business ledger is for, spliced in where the personal framing would
 * otherwise carry the whole weight.
 *
 * The categories alone are not enough. Shown a business chart of accounts, a
 * model still reasons like a household budgeter unless told the question has
 * changed — from "what did I spend this on" to "what did it cost to earn this,
 * and what is deductible" — and that some money leaving is neither.
 */
const BUSINESS_FRAMING = `<business_ledger>
These are business transactions, not household ones. You are sorting them for a profit-and-loss statement and a tax return, so two distinctions matter that do not exist in a personal budget.

Cost of goods sold versus operating expense. COGS is what it cost to deliver what was sold: materials, inventory, subcontractors doing billable work, payment processing taken out of revenue. Operating expenses are the cost of being in business at all: software, rent, marketing, insurance. Gross margin is meaningless when these are mixed, and the merchant name alone rarely tells you which — a laptop is equipment, the same laptop bought to resell is inventory.

Money that leaves without being an expense. An owner's draw is profit being withdrawn, not a cost of earning it. An estimated tax payment is personal tax on business profit. Neither is deductible, and filing either as an expense understates profit and overstates deductions — on a tax return that is a real error rather than an untidy one. Use owner-draw or estimated-taxes, and set is_transfer true for both.

A transfer to a personal account, a distribution, or an ACH addressed to the owner's own name is a draw. When a payment to an individual could be either a subcontractor or a draw, say which in the reason and give it low confidence rather than guessing at a deduction that may not exist.

Revenue is money from customers. Money the owner puts in is owner-contribution, not revenue — nobody paid for anything.
</business_ledger>`;

function buildSystemPrompt(
  cats: CategoryOption[],
  mode: "personal" | "business" = "personal",
): string {
  const lines = cats.map((c) => {
    const parent = c.parentName ? ` (under ${c.parentName})` : "";
    const hint = c.hint ? ` — ${c.hint}` : "";
    return `- ${c.slug}: ${c.name}${parent} [${c.kind}]${hint}`;
  });

  const opening =
    mode === "business"
      ? "You categorize business bank and credit card transactions for a small company's books."
      : "You categorize personal bank and credit card transactions.";

  return `${opening}

You will receive a batch of transactions. For each one, choose exactly one category from the taxonomy below and return it by its slug.

<taxonomy>
${lines.join("\n")}
</taxonomy>

${mode === "business" ? BUSINESS_FRAMING : ""}

<amount_convention>
Amounts are shown as the account sees them: a negative amount is money leaving the account (a purchase, a bill, a withdrawal); a positive amount is money arriving (a paycheck, a refund, interest).

The sign is strong evidence. A positive amount at a merchant you would normally treat as spending is almost always a refund, not a purchase. On a credit card, a positive amount is usually a payment toward the balance, which is card-payment and a transfer.

Amounts are already normalized to this convention before you see them, including on credit card statements where the printed sign is inverted. Do not re-invert: a negative amount on a card is a purchase, not a payment.

Sign also separates categories that share a description. Money moving out to a brokerage is investments; the same name arriving is investment-withdrawal.
</amount_convention>

<how_to_choose>
Read the description for the merchant, then pick the category that matches what the money was actually spent on.

Prefer the most specific category that the evidence supports. "amazon" with no further detail is general-merchandise, not electronics — you cannot tell what was in the box. But "amazon web services" is software, because the merchant itself tells you.

Some descriptions carry a product or service word that overrides the parent brand. Uber Eats is food delivery even though Uber is rideshare. A warehouse club fuel purchase is gas, not groceries.

When two categories are genuinely defensible, choose the one a careful person doing their own budget would pick, and say so in the reason. Use uncategorized only when the description is opaque enough that any choice would be a guess — a bare reference number, an unlabeled ACH, initials with no merchant.
</how_to_choose>

<transfers>
is_transfer is not a category. Every transaction gets a real category regardless of how you set it, and you must still choose one here.

Set is_transfer to true when the same dollar is already counted somewhere else in this ledger. There are exactly two cases:

1. A move between two accounts the person owns, where the description names the other account — "Online Transfer to CHK ...1234", "Transfer to Savings", "Internal Transfer". Category: transfer.

2. A credit card payment — "Payment to Chase card ending in 1234", "CAPITAL ONE MOBILE PMT", "AUTOPAY PAYMENT", "PAYMENT THANK YOU". Category: card-payment. The purchases charged to that card are the spending; the payment only settles the balance, so counting it too would count the same money twice. This holds for both sides: the debit leaving checking and the matching credit on the card statement, which is positive but is not income.

Set is_transfer to false for everything else, including these, which are commonly mistaken for transfers:

- Money sent to a person through Venmo, Zelle, Cash App or PayPal. That money left the person's net worth and is not coming back — it is spending. The rail is not the category. Read the rest of the description for what it bought and categorize that; when it is only a name or a reference number, answer person-to-person, which counts as spending and flags the row for the user to refile. Do not answer "transfer", and do not answer "uncategorized" merely because the counterparty is a person.
- ATM and teller withdrawals — cash-withdrawal.
- Money moving into a brokerage, retirement or savings account — investments. Money coming back out of one — investment-withdrawal.
- Money arriving from a person, including a Venmo cash-out — refunds.
- Anything charged to a credit card. A purchase is a purchase whichever account it landed on; categorize it by what was bought.

A wrong is_transfer flag deletes real money from every downstream number, which is worse than a merely imprecise category. When you are unsure, set it false and pick the best category you can.

Be strictest about this on money arriving. Every positive amount is income unless it is provably the person's own money coming back — an internal transfer that names the other account, or a payment landing on a card statement. Nothing else qualifies. In particular, money arriving *from* a bank or card issuer is a refund, a cashback redemption, interest or a reversal, all of which are income; the institution's name in the description is not evidence of a transfer. Income is only ever lost through this flag — an imperfect category still counts — so when an inflow is not clearly one of those two cases, set is_transfer false.
</transfers>

<confidence>
Report confidence as a number from 0 to 1 reflecting how sure you are of the category.

Use above 0.9 when the merchant is named outright and its category is unambiguous. Use 0.6 to 0.9 when the merchant is identifiable but the category involves a judgment call. Use below 0.5 when you are inferring from thin evidence — these get surfaced to the user for review, so an honest low score is more useful than a confident guess.
</confidence>

<merchant>
Return the clean, human-readable merchant name with the processor prefixes, store numbers, and city/state tails removed: "SQ *BLUE BOTTLE COFFEE SPRINGFIELD CO" becomes "Blue Bottle Coffee". If no merchant is identifiable, return null.
</merchant>

<reason>
One short clause naming the evidence you used — the merchant, the sign, or the giveaway word. "Coffee chain", "positive amount on a card, so a refund", "Eats in the description". This is shown to the user next to low-confidence rows, so it should tell them what to check, not restate the category.
</reason>

Return one entry per input transaction, with the same id. Do not merge, drop, or reorder them.`;
}

function renderTransactions(txns: ClassifiableTransaction[]): string {
  return txns
    .map((t) => {
      const acct = t.accountKind ? ` account=${t.accountKind}` : "";
      const rail = t.merchantHint ? ` rail=${t.merchantHint}` : "";
      return `id=${t.id} date=${t.postedOn} amount=${formatCents(t.amountCents, { signed: true })}${acct}${rail}\n  ${t.rawDescription}`;
    })
    .join("\n\n");
}

/**
 * Classify one batch. The taxonomy sits in a cached system prompt so repeated
 * batches only pay full price for the transaction list.
 */
export async function classifyBatch(
  txns: ClassifiableTransaction[],
  cats: CategoryOption[],
  mode: "personal" | "business" = "personal",
): Promise<LlmBatchResult> {
  const provider = requireAi();
  const started = Date.now();

  const validSlugs = new Set(cats.map((c) => c.slug));

  const result = await provider.complete({
    system: buildSystemPrompt(cats, mode),
    maxTokens: 16000,
    effort: "low",
    // Identical across every batch, so it is worth caching where supported.
    cacheSystem: true,
    jsonSchema: {
      name: "classifications",
      schema: {
        type: "object",
        properties: {
          classifications: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                category: { type: "string", enum: cats.map((c) => c.slug) },
                merchant: { type: ["string", "null"] },
                confidence: { type: "number" },
                reason: { type: "string" },
                is_transfer: { type: "boolean" },
              },
              required: [
                "id",
                "category",
                "merchant",
                "confidence",
                "reason",
                "is_transfer",
              ],
              additionalProperties: false,
            },
          },
        },
        required: ["classifications"],
        additionalProperties: false,
      },
    },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Categorize these ${txns.length} transactions:\n\n${renderTransactions(txns)}`,
          },
        ],
      },
    ],
  });

  const ms = Date.now() - started;
  const usage = result.usage;

  if (result.refused) {
    throw new Error(
      "The classifier declined this batch. Check for unusual content in the descriptions.",
    );
  }

  const raw = result.text;
  let parsed: z.infer<typeof responseSchema>;
  try {
    parsed = responseSchema.parse(JSON.parse(raw));
  } catch (err) {
    throw new Error(
      `Classifier returned unreadable output: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const byId = new Map(txns.map((t) => [t.id, t]));
  const classifications: LlmClassification[] = [];

  for (const c of parsed.classifications) {
    // Guard against a hallucinated id or slug rather than trusting the schema
    // alone — a mislabeled row would silently attach to the wrong transaction.
    if (!byId.has(c.id)) continue;
    if (!validSlugs.has(c.category)) continue;

    classifications.push({
      id: c.id,
      categorySlug: c.category,
      merchant: c.merchant?.trim() || null,
      confidence: Math.min(1, Math.max(0, c.confidence)),
      reason: c.reason.trim(),
      isTransfer: c.is_transfer,
    });
  }

  return { classifications, usage, ms };
}

/** Split into batches and classify each, accumulating usage. */
export async function classifyAll(
  txns: ClassifiableTransaction[],
  cats: CategoryOption[],
  opts: {
    onProgress?: (done: number, total: number) => void;
    mode?: "personal" | "business";
  } = {},
): Promise<LlmBatchResult> {
  const all: LlmClassification[] = [];
  const usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  const started = Date.now();

  for (let i = 0; i < txns.length; i += BATCH_SIZE) {
    const batch = txns.slice(i, i + BATCH_SIZE);
    const result = await classifyBatch(batch, cats, opts.mode ?? "personal");
    all.push(...result.classifications);
    usage.inputTokens += result.usage.inputTokens;
    usage.outputTokens += result.usage.outputTokens;
    usage.cacheReadTokens += result.usage.cacheReadTokens;
    opts.onProgress?.(Math.min(i + BATCH_SIZE, txns.length), txns.length);
  }

  return { classifications: all, usage, ms: Date.now() - started };
}
