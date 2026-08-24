import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { statements, transactions, accounts } from "@/db/schema";
import { detectSourceKind, type ParseResult } from "./parse/types";
import { dedupeHash, normalizeDescription, sha256Hex } from "./classify/normalize";
import { classifyTransactions, type ClassifyReport } from "./classify";
import { predictCategorySlug } from "./classify/rules";
import { resolveFileSource } from "./sources";
import "./sources/builtin";
import { refreshRecurringSeries } from "./recurring";
import {
  pendingCandidatesNear,
  absorbIntoStatementRow,
  bestMatch,
  type ReconcileOutcome,
} from "./reconcile";

export type IngestResult = {
  statementId: string;
  status: "parsed" | "failed" | "duplicate_file";
  inserted: number;
  duplicates: number;
  /** Purchases you had already logged that this statement confirmed. */
  reconciled: number;
  /** One line per merge, so a wrong match is visible rather than silent. */
  reconciliationNotes: string[];
  warnings: string[];
  periodStart?: string | null;
  periodEnd?: string | null;
  classification?: ClassifyReport;
  error?: string;
};

export class IngestError extends Error {
  constructor(
    message: string,
    readonly userFacing = true,
  ) {
    super(message);
    this.name = "IngestError";
  }
}

/**
 * Ingest one uploaded statement.
 *
 * The whole design goal is that this is safe to call at any time with any
 * statement, including one that overlaps a period already imported. Two layers
 * make that true: the file hash short-circuits an identical re-upload, and the
 * per-transaction dedupe hash drops rows that are already in the ledger.
 */
export async function ingestStatement(input: {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
  accountId?: string | null;
  /** Skip the model even when a key is present (rules-only import). */
  useLlm?: boolean;
}): Promise<IngestResult> {
  const sourceKind = detectSourceKind(input.mimeType, input.filename);
  if (!sourceKind) {
    throw new IngestError(
      `Unsupported file type "${input.mimeType || input.filename}". Upload a CSV export, a PDF statement, or a screenshot.`,
    );
  }

  const contentHash = await sha256Hex(input.bytes);

  const existing = await db
    .select({ id: statements.id, count: statements.transactionCount })
    .from(statements)
    .where(eq(statements.contentHash, contentHash))
    .limit(1);

  if (existing[0]) {
    return {
      statementId: existing[0].id,
      status: "duplicate_file",
      inserted: 0,
      duplicates: existing[0].count,
      reconciled: 0,
      reconciliationNotes: [],
      warnings: [
        "This exact file has already been imported, so nothing was added.",
      ],
    };
  }

  const [statement] = await db
    .insert(statements)
    .values({
      accountId: input.accountId ?? null,
      filename: input.filename,
      mimeType: input.mimeType,
      sourceKind,
      byteSize: input.bytes.byteLength,
      contentHash,
      status: "parsing",
    })
    .returning();

  const statementId = statement!.id;

  try {
    let parsed: ParseResult;

    /*
     * The account kind decides how an all-positive file is read. A CSV cannot
     * say whether it writes spending as a positive number, so this is the only
     * signal available — and getting it wrong on a deposit account negates
     * every paycheck in the file.
     */
    const accountKind = input.accountId
      ? ((
          await db
            .select({ kind: accounts.kind })
            .from(accounts)
            .where(eq(accounts.id, input.accountId))
            .limit(1)
        )[0]?.kind ?? null)
      : null;

    /*
     * Adapters are looked up rather than branched on, so adding a bank-specific
     * importer means registering one and touching nothing here.
     */
    const source = resolveFileSource({
      mimeType: input.mimeType,
      filename: input.filename,
    });
    if (!source) {
      throw new IngestError(
        `No importer handles "${input.mimeType || input.filename}". Upload a CSV export, a PDF statement, or a screenshot.`,
      );
    }

    parsed = await source.parse({
      bytes: input.bytes,
      filename: input.filename,
      mimeType: input.mimeType,
      accountKind,
    });

    if (parsed.transactions.length === 0) {
      const detail = parsed.warnings.length
        ? ` ${parsed.warnings.join(" ")}`
        : "";
      throw new IngestError(`No transactions were found in this file.${detail}`);
    }

    // Resolve the account: use the one given, otherwise try to match the hint
    // the document gave us, otherwise leave it unassigned.
    const accountId =
      input.accountId ?? (await resolveAccount(parsed.accountHint)) ?? null;

    // Build rows with dedupe hashes, and drop duplicates inside this file too
    // — statements sometimes repeat a row across a page break.
    const seen = new Set<string>();
    const candidates: Array<{
      dedupeHash: string;
      postedOn: string;
      amountCents: number;
      rawDescription: string;
      currency: string;
    }> = [];

    for (const t of parsed.transactions) {
      const normalized = normalizeDescription(t.rawDescription);
      const hash = await dedupeHash({
        accountId,
        postedOn: t.postedOn,
        amountCents: t.amountCents,
        normalizedDescription: normalized,
      });
      if (seen.has(hash)) continue;
      seen.add(hash);
      candidates.push({
        dedupeHash: hash,
        postedOn: t.postedOn,
        amountCents: t.amountCents,
        rawDescription: t.rawDescription,
        currency: t.currency ?? "USD",
      });
    }

    // Which of these are already in the ledger?
    const hashes = candidates.map((c) => c.dedupeHash);
    const alreadyPresent = new Set<string>();
    for (let i = 0; i < hashes.length; i += 500) {
      const chunk = hashes.slice(i, i + 500);
      const rows = await db
        .select({ dedupeHash: transactions.dedupeHash })
        .from(transactions)
        .where(inArray(transactions.dedupeHash, chunk));
      for (const r of rows) alreadyPresent.add(r.dedupeHash);
    }

    const fresh = candidates.filter((c) => !alreadyPresent.has(c.dedupeHash));
    const duplicates = candidates.length - fresh.length;

    /*
     * Second dedupe pass, against purchases logged conversationally.
     *
     * The hash above only catches a row already in the ledger verbatim, which
     * is what re-uploading a statement produces. A purchase someone logged by
     * voice has a different date (posting lag), a different description, and
     * possibly a different amount (a tip), so it needs fuzzy matching — see
     * lib/reconcile/match.ts for the scoring and its limits.
     */
    const reconciled: ReconcileOutcome[] = [];
    const consumed = new Set<string>();
    const toInsert: typeof fresh = [];

    for (const c of fresh) {
      const pending = await pendingCandidatesNear(c.postedOn, consumed);
      // Rules-only, so this stays fast inside the import loop. When no rule
      // matches, the category signal is simply unavailable for this row.
      const categorySlug =
        pending.length > 0
          ? await predictCategorySlug(c.rawDescription, c.amountCents)
          : null;
      const match =
        pending.length > 0
          ? bestMatch(
              {
                postedOn: c.postedOn,
                amountCents: c.amountCents,
                rawDescription: c.rawDescription,
                categorySlug,
              },
              pending,
            )
          : null;

      if (match) {
        const outcome = await absorbIntoStatementRow({
          match,
          statementRow: c,
          statementId,
          accountId,
        });
        // One pending entry can only settle one statement row.
        consumed.add(match.candidate.id);
        reconciled.push(outcome);
      } else {
        toInsert.push(c);
      }
    }

    let insertedIds: string[] = [];
    if (toInsert.length > 0) {
      const inserted = await db
        .insert(transactions)
        .values(
          toInsert.map((c) => ({
            accountId,
            statementId,
            postedOn: c.postedOn,
            amountCents: c.amountCents,
            rawDescription: c.rawDescription,
            currency: c.currency,
            dedupeHash: c.dedupeHash,
            entrySource: "statement" as const,
            status: "cleared" as const,
          })),
        )
        // A concurrent upload of an overlapping statement could race us
        // between the check above and this insert.
        .onConflictDoNothing({ target: transactions.dedupeHash })
        .returning({ id: transactions.id });
      insertedIds = inserted.map((r) => r.id);
    }

    const dates = candidates.map((c) => c.postedOn).sort();
    const periodStart = parsed.periodStart ?? dates[0] ?? null;
    const periodEnd = parsed.periodEnd ?? dates[dates.length - 1] ?? null;

    // Classify only what we just added.
    let classification: ClassifyReport | undefined;
    if (insertedIds.length > 0) {
      classification = await classifyTransactions(insertedIds, {
        useLlm: input.useLlm,
      });
    }

    const warnings = [...parsed.warnings];
    if (duplicates > 0) {
      warnings.push(
        `${duplicates} transaction${duplicates === 1 ? " was" : "s were"} already in the ledger and ${duplicates === 1 ? "was" : "were"} skipped.`,
      );
    }
    if (reconciled.length > 0) {
      warnings.push(
        `${reconciled.length} purchase${reconciled.length === 1 ? "" : "s"} you had already logged ${reconciled.length === 1 ? "was" : "were"} matched to this statement rather than added again.`,
      );
    }
    if (classification?.llmError) {
      warnings.push(
        `Automatic categorization did not finish: ${classification.llmError}. The imported rows are in Uncategorized and can be re-run from Transactions.`,
      );
    }

    await db
      .update(statements)
      .set({
        status: "parsed",
        accountId,
        periodStart,
        periodEnd,
        transactionCount: insertedIds.length,
        duplicateCount: duplicates,
        parseUsage: parsed.usage ?? null,
        parsedAt: new Date(),
        error: warnings.length ? warnings.join(" ") : null,
      })
      .where(eq(statements.id, statementId));

    // Recurring detection reads the whole ledger, so it runs after the insert.
    if (insertedIds.length > 0) {
      try {
        await refreshRecurringSeries();
      } catch (err) {
        console.error("recurring refresh failed", err);
      }
    }

    return {
      statementId,
      status: "parsed",
      inserted: insertedIds.length,
      duplicates,
      reconciled: reconciled.length,
      reconciliationNotes: reconciled.map((r) => {
        const m = r.match.candidate;
        const when = new Date(m.postedOn).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        });
        const what = m.merchant ?? m.rawDescription;
        const adjust =
          r.amountDeltaCents !== 0
            ? `, amount corrected to the statement figure (${
                r.amountDeltaCents > 0 ? "+" : ""
              }${(r.amountDeltaCents / 100).toFixed(2)})`
            : "";
        return `Matched the ${what} purchase you logged on ${when} — ${r.match.explanation}${adjust}.`;
      }),
      warnings,
      periodStart,
      periodEnd,
      classification,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(statements)
      .set({ status: "failed", error: message })
      .where(eq(statements.id, statementId));

    if (err instanceof IngestError) throw err;
    console.error("statement ingest failed", err);
    throw new IngestError(`Could not import this statement: ${message}`);
  }
}

/** Best-effort account match from what the document told us about itself. */
async function resolveAccount(
  hint: ParseResult["accountHint"],
): Promise<string | null> {
  if (!hint?.last4) return null;
  const rows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.last4, hint.last4))
    .limit(1);
  return rows[0]?.id ?? null;
}
