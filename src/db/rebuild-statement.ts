import { readFileSync, writeFileSync } from "node:fs";
import { eq, inArray } from "drizzle-orm";
import { db } from "./index";
import { accounts, categories, statements, transactions } from "./schema";
import { ingestStatement } from "@/lib/ingest";

type SnapshotRow = {
  postedOn: string;
  amountCents: number;
  rawDescription: string;
  merchant: string | null;
  slug: string | null;
  isTransfer: boolean;
  source: string;
  confidence: number | null;
};

/**
 * Clear one account's rows and import the file again from scratch.
 *
 * Re-uploading cannot do this: the file hash short-circuits an identical
 * upload, and the per-transaction hashes drop the rows individually. That is
 * the point of both layers. So exercising the import path end to end after a
 * rules change means deleting first, which is only safe with the two halves
 * here — a snapshot written before anything is dropped, and `replayManual`
 * to put the hand-set categories back.
 *
 * `pnpm db:reclassify` is the everyday tool, and does not delete anything.
 * This one additionally re-runs parsing, sign detection, account assignment,
 * dedupe and reconciliation.
 */
export async function rebuildFromFile(input: {
  path: string;
  filename: string;
  accountLast4: string;
  snapshotPath: string;
}): Promise<void> {
  const [account] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.last4, input.accountLast4));
  if (!account) throw new Error(`No account ending ${input.accountLast4}`);

  // --- Snapshot before touching anything ----------------------------------
  const before = await db
    .select({
      postedOn: transactions.postedOn,
      amountCents: transactions.amountCents,
      rawDescription: transactions.rawDescription,
      merchant: transactions.merchant,
      slug: categories.slug,
      isTransfer: transactions.isTransfer,
      source: transactions.classificationSource,
      confidence: transactions.classificationConfidence,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(eq(transactions.accountId, account.id));

  writeFileSync(input.snapshotPath, JSON.stringify(before, null, 2));
  const manual = before.filter((r) => r.source === "manual");
  console.log(
    `snapshot: ${before.length} rows (${manual.length} hand-set) -> ${input.snapshotPath}`,
  );

  // --- Clear --------------------------------------------------------------
  const dropped = await db
    .delete(transactions)
    .where(eq(transactions.accountId, account.id))
    .returning({ id: transactions.id, statementId: transactions.statementId });

  // The statement row carries the file hash that short-circuits a re-upload,
  // so it has to go too or the import returns "duplicate_file".
  const statementIds = [
    ...new Set(dropped.map((d) => d.statementId).filter((v): v is string => !!v)),
  ];
  if (statementIds.length > 0) {
    await db.delete(statements).where(inArray(statements.id, statementIds));
  }
  console.log(
    `deleted ${dropped.length} transactions and ${statementIds.length} statement record(s)`,
  );

  // --- Re-import through the real path ------------------------------------
  const result = await ingestStatement({
    filename: input.filename,
    mimeType: "text/csv",
    bytes: new Uint8Array(readFileSync(input.path)),
    accountId: account.id,
  });

  console.log(
    `\nimport: ${result.status} — ${result.inserted} inserted, ` +
      `${result.duplicates} deduped, ${result.reconciled} reconciled`,
  );
  for (const w of result.warnings) console.log(`  warning: ${w}`);
}

/**
 * Put the hand-set categories back, matching on the verbatim description.
 *
 * Kept separate from the rebuild so the pipeline's unaided output can be
 * inspected first — that is the whole reason for re-importing rather than
 * reclassifying, and replaying immediately would paper over it.
 */
export async function replayManual(
  snapshotPath: string,
): Promise<{ replayed: number; missing: string[] }> {
  const snapshot: SnapshotRow[] = JSON.parse(readFileSync(snapshotPath, "utf8"));
  const manual = snapshot.filter((r) => r.source === "manual" && r.slug);

  const slugToId = new Map(
    (
      await db
        .select({ id: categories.id, slug: categories.slug })
        .from(categories)
    ).map((c) => [c.slug, c.id]),
  );

  let replayed = 0;
  const missing: string[] = [];

  for (const m of manual) {
    const categoryId = slugToId.get(m.slug!);
    if (!categoryId) {
      missing.push(`${m.rawDescription} (no category "${m.slug}")`);
      continue;
    }

    const [row] = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.rawDescription, m.rawDescription))
      .limit(1);
    if (!row) {
      missing.push(m.rawDescription);
      continue;
    }

    await db
      .update(transactions)
      .set({
        categoryId,
        isTransfer: m.isTransfer,
        classificationSource: "manual",
        classificationConfidence: 1,
        classificationReason: "Set by you",
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, row.id));
    replayed += 1;
  }

  return { replayed, missing };
}

if (process.argv[1]?.endsWith("rebuild-statement.ts")) {
  const snapshotPath = process.env.SNAPSHOT ?? "./ledger-snapshot.json";
  const statementPath = process.env.STATEMENT ?? "";
  const accountLast4 = process.env.ACCOUNT_LAST4 ?? "";

  if (!process.argv.includes("--replay-only") && (!statementPath || !accountLast4)) {
    console.error(
      "Set STATEMENT and ACCOUNT_LAST4.\n" +
        "  STATEMENT=./statement.csv ACCOUNT_LAST4=1234 pnpm db:rebuild-statement",
    );
    process.exit(1);
  }

  const run = process.argv.includes("--replay-only")
    ? replayManual(snapshotPath).then((r) => {
        console.log(`replayed ${r.replayed} hand-set categories`);
        for (const m of r.missing) console.log(`  could not match: ${m}`);
      })
    : rebuildFromFile({
        path: statementPath,
        filename: process.env.STATEMENT_NAME ?? statementPath.split("/").pop()!,
        accountLast4: accountLast4,
        snapshotPath,
      });

  run
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("rebuild failed", err);
      process.exit(1);
    });
}
