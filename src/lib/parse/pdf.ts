import { z } from "zod";
import { requireDocumentAi, type AiContent } from "@/lib/ai";
import { parseAmountToCents } from "@/lib/money";
import type { ParseResult, ParsedTransaction } from "./types";

/**
 * PDF and image statements are read by Claude rather than by per-bank
 * templates. Layouts vary wildly between institutions and change without
 * notice; a model that reads the document the way a person would is the only
 * approach that doesn't need maintenance per bank.
 */

const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    account: {
      type: "object",
      properties: {
        institution: { type: ["string", "null"] },
        last4: { type: ["string", "null"] },
        kind: {
          type: ["string", "null"],
          enum: [
            "checking",
            "savings",
            "credit_card",
            "investment",
            "loan",
            "cash",
            null,
          ],
        },
      },
      required: ["institution", "last4", "kind"],
      additionalProperties: false,
    },
    period_start: { type: ["string", "null"] },
    period_end: { type: ["string", "null"] },
    statement_year: { type: ["integer", "null"] },
    transactions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          date: { type: "string" },
          description: { type: "string" },
          amount: { type: "string" },
          direction: { type: "string", enum: ["debit", "credit"] },
        },
        required: ["date", "description", "amount", "direction"],
        additionalProperties: false,
      },
    },
    notes: { type: ["string", "null"] },
  },
  required: [
    "account",
    "period_start",
    "period_end",
    "statement_year",
    "transactions",
    "notes",
  ],
  additionalProperties: false,
} as const;

const extractionSchema = z.object({
  account: z.object({
    institution: z.string().nullable(),
    last4: z.string().nullable(),
    kind: z.string().nullable(),
  }),
  period_start: z.string().nullable(),
  period_end: z.string().nullable(),
  statement_year: z.number().int().nullable(),
  transactions: z.array(
    z.object({
      date: z.string(),
      description: z.string(),
      amount: z.string(),
      direction: z.enum(["debit", "credit"]),
    }),
  ),
  notes: z.string().nullable(),
});

const SYSTEM_PROMPT = `You extract transactions from bank and credit card statements.

Read the document and return every individual transaction in the transaction table(s). Work through the pages in order and do not stop early — statements often run to several pages and the last page is as important as the first.

<what_counts>
Include every posted transaction: purchases, payments, deposits, withdrawals, transfers, fees, interest, and adjustments.

Exclude anything that is not itself a transaction: opening and closing balances, subtotals, "total fees for this period" summary lines, running balance columns, rewards-points tables, and minimum-payment boxes. A line that summarizes other lines would be double counting.

Pending transactions are usually listed in their own section. Include them, since the ledger deduplicates on re-upload and will reconcile them once they post.
</what_counts>

<dates>
Return each date as ISO yyyy-mm-dd.

Many statements print dates as MM/DD with no year. Use the statement period to infer it, and watch the year boundary: a December date on a statement whose period ends in January belongs to the previous year. Report the year you inferred in statement_year.

When a row has both a transaction date and a posting date, use the transaction date — it is when the money was actually spent.
</dates>

<amounts>
Return the amount as it is printed, as a string, without a sign: "45.20", "1,234.56".

Put the direction in the direction field instead. Use "debit" for money leaving the account and "credit" for money arriving.

On a checking account, a purchase or withdrawal is a debit and a deposit is a credit. On a credit card the convention inverts: a purchase increases what you owe and is a debit, while a payment or a refund reduces it and is a credit. Statements often signal this with a CR suffix, a separate column, or parentheses — follow the document.
</amounts>

<descriptions>
Copy the description exactly as printed, including processor prefixes and location text. Do not clean it up, expand abbreviations, or guess the merchant — a later step does that, and it needs the original.

If a description wraps onto a second line, join it into one string with a single space.
</descriptions>

<accuracy>
Accuracy matters more than coverage here. If a value is genuinely illegible, omit that transaction and say so in notes rather than guessing at a digit — a wrong amount is worse than a missing row, because it silently corrupts every total downstream.

Use notes for anything the reader should know: pages you could not read, sections you skipped, an ambiguous year, or a table that did not parse cleanly.
</accuracy>`;

function toIsoLoose(input: string, fallbackYear: number | null): string | null {
  const s = input.trim();

  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    return normalize(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  const md = s.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (md) {
    let year = md[3] ? Number(md[3]) : (fallbackYear ?? new Date().getUTCFullYear());
    if (year < 100) year += year < 70 ? 2000 : 1900;
    return normalize(year, Number(md[1]), Number(md[2]));
  }

  return null;
}

function normalize(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d.toISOString().slice(0, 10);
}

export async function parseDocumentStatement(input: {
  bytes: Uint8Array;
  mimeType: string;
  kind: "pdf" | "image";
}): Promise<ParseResult> {
  // Gated on document support rather than assumed: most OpenAI-compatible
  // endpoints take images but not PDFs, and the error should say which
  // provider is configured rather than fail deep inside a parse.
  const provider = requireDocumentAi();
  const started = Date.now();

  const base64 = Buffer.from(input.bytes).toString("base64");

  const documentBlock: AiContent =
    input.kind === "pdf"
      ? { type: "document", mediaType: "application/pdf", dataBase64: base64 }
      : { type: "image", mediaType: input.mimeType, dataBase64: base64 };

  const result = await provider.complete({
    system: SYSTEM_PROMPT,
    maxTokens: 32000,
    effort: "medium",
    jsonSchema: { name: "extraction", schema: EXTRACTION_SCHEMA },
    messages: [
      {
        role: "user",
        content: [
          documentBlock,
          {
            type: "text",
            text: "Extract every transaction from this statement.",
          },
        ],
      },
    ],
  });

  const ms = Date.now() - started;

  if (result.refused) {
    throw new Error(
      "The document could not be processed. If it contains unusual content, try exporting a CSV instead.",
    );
  }

  const warnings: string[] = [];
  if (!result.text.trim().endsWith("}")) {
    warnings.push(
      "The statement was long enough to hit the extraction limit — some transactions near the end may be missing. Re-upload the remaining pages separately, or use a CSV export.",
    );
  }

  let parsed: z.infer<typeof extractionSchema>;
  try {
    parsed = extractionSchema.parse(JSON.parse(result.text));
  } catch (err) {
    throw new Error(
      `Could not read the extraction result: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (parsed.notes) warnings.push(parsed.notes);

  const fallbackYear =
    parsed.statement_year ??
    (parsed.period_end ? Number(parsed.period_end.slice(0, 4)) : null);

  const transactions: ParsedTransaction[] = [];
  let skipped = 0;

  for (const t of parsed.transactions) {
    const postedOn = toIsoLoose(t.date, fallbackYear);
    const magnitude = parseAmountToCents(t.amount);
    if (!postedOn || magnitude === null || magnitude === 0) {
      skipped++;
      continue;
    }
    const abs = Math.abs(magnitude);
    transactions.push({
      postedOn,
      amountCents: t.direction === "debit" ? -abs : abs,
      rawDescription: t.description.trim(),
    });
  }

  if (skipped > 0) {
    warnings.push(
      `${skipped} extracted row${skipped === 1 ? "" : "s"} had an unreadable date or amount and were dropped.`,
    );
  }

  const usage = result.usage;

  return {
    transactions,
    warnings,
    periodStart: parsed.period_start,
    periodEnd: parsed.period_end,
    accountHint: {
      institution: parsed.account.institution,
      last4: parsed.account.last4,
      kind: parsed.account.kind,
    },
    usage: { model: provider.model, ...usage, ms },
  };
}
