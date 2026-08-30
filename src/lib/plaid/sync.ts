import { and, eq, isNull, isNotNull, max, min, sql } from "drizzle-orm";
import type { Transaction as PlaidTransaction, RemovedTransaction } from "plaid";
import { db } from "@/db";
import { recordBalance } from "@/lib/balance-history";
import { accounts, plaidItems, statements, transactions } from "@/db/schema";
import { classifyTransactions } from "@/lib/classify";
import { dedupeHash, normalizeDescription } from "@/lib/classify/normalize";
import { plaidClient, plaidErrorCode, plaidErrorMessage } from "./client";
import { decryptToken } from "./crypto";

export type SyncReport = {
  institution: string;
  added: number;
  updated: number;
  removed: number;
  /** Skipped because a statement import already covers that date. */
  alreadyCovered: number;
  /** Skipped because an identical row was already in the ledger. */
  duplicates: number;
  classified: number;
  /** Times pagination had to restart because Plaid's data moved underneath. */
  restarts: number;
  /** Ids of rows this run created, so alerting can look only at what is new. */
  addedIds: string[];
  /** Whether the bank was re-read before syncing, rather than Plaid's cache. */
  refreshed: boolean;
  error?: string;
};

/**
 * Plaid signs amounts the opposite way round from this ledger: for Plaid a
 * positive amount is money leaving the account. Flipping here, once, keeps the
 * "negative = money out" invariant true everywhere downstream — the ledger math
 * and every classification rule depend on it.
 *
 * Cents come from a float, so this is the one place rounding happens.
 */
function toLedgerCents(plaidAmount: number): number {
  return -Math.round(plaidAmount * 100);
}

/**
 * The description to store. Plaid's `name` is the cleaned merchant, while
 * `original_description` is what the bank actually sent — which is what the
 * normalizer and every seed rule were written against. Prefer the raw one and
 * fall back.
 */
function describe(t: PlaidTransaction): string {
  return t.original_description?.trim() || t.name;
}

export type CoveredRange = { start: string; end: string };

/**
 * The date ranges an account already has from statement imports.
 *
 * A synced row inside one of these is skipped: Plaid's description for a
 * charge rarely normalizes to the same string as the bank's CSV, so
 * `dedupe_hash` would not catch the overlap and the period would double.
 *
 * This used to be a single cutoff date — skip everything on or before the last
 * statement row — which was wrong in a way that only showed up once an account
 * had real history behind it. A statement covering 3–21 August blocked *June
 * and July as well*, so a checking account that had one month uploaded could
 * never backfill the months before it, and those months rendered as periods
 * with card spending and no income.
 *
 * Ranges fix that: only the covered window is skipped, and everything outside
 * it — before or after — imports normally.
 *
 * Preferring the statement's declared period over the span of its rows matters
 * at the edges. A statement covering the whole month whose first transaction
 * lands on the 3rd still covers the 1st and 2nd, and a Plaid row there would
 * otherwise slip in as a duplicate the statement recorded differently.
 */
async function coveredRangesFor(accountId: string): Promise<CoveredRange[]> {
  const declared = await db
    .select({
      start: statements.periodStart,
      end: statements.periodEnd,
    })
    .from(statements)
    .where(
      and(eq(statements.accountId, accountId), eq(statements.status, "parsed")),
    );

  const ranges = declared
    .filter((r): r is { start: string; end: string } =>
      Boolean(r.start && r.end),
    )
    .map((r) => ({ start: r.start, end: r.end }));

  if (ranges.length > 0) return ranges;

  /*
   * Fallback for rows that arrived without a statement period — the span of
   * whatever was imported by hand. Still a range, so it cannot swallow
   * everything that came before it.
   */
  const [span] = await db
    .select({
      first: min(transactions.postedOn),
      last: max(transactions.postedOn),
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.accountId, accountId),
        isNull(transactions.plaidTransactionId),
      ),
    );

  return span?.first && span.last
    ? [{ start: span.first, end: span.last }]
    : [];
}

function isCovered(date: string, ranges: CoveredRange[]): boolean {
  return ranges.some((r) => date >= r.start && date <= r.end);
}

/**
 * Ask Plaid to fetch fresh data from the bank, and wait for it to land.
 *
 * `transactions/sync` reads **Plaid's cache**, not the bank. Plaid refreshes an
 * Item on its own schedule — often only once or twice a day — so without this
 * a sync faithfully returns yesterday's data and looks like it worked. That is
 * exactly what "why aren't today's transactions showing" turned out to be.
 *
 * The refresh is asynchronous: Plaid returns immediately and fetches in the
 * background, so the timestamp is polled until it advances. Bounded, because a
 * bank that is slow or down must not hold the sync open indefinitely — and
 * syncing stale data is a far better outcome than not syncing at all.
 */
async function refreshFromBank(
  client: ReturnType<typeof plaidClient>,
  accessToken: string,
  timeoutMs = 25_000,
): Promise<boolean> {
  const before = await client
    .itemGet({ access_token: accessToken })
    .then((r) => (r.data as { status?: { transactions?: { last_successful_update?: string } } }).status?.transactions?.last_successful_update ?? null)
    .catch(() => null);

  try {
    await client.transactionsRefresh({ access_token: accessToken });
  } catch (err) {
    /*
     * Not every plan includes on-demand refresh. Failing here is survivable —
     * the sync still runs against whatever Plaid last fetched — so it is
     * logged rather than thrown.
     */
    console.warn("on-demand refresh unavailable:", plaidErrorCode(err));
    return false;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2_000));
    const now = await client
      .itemGet({ access_token: accessToken })
      .then((r) => (r.data as { status?: { transactions?: { last_successful_update?: string } } }).status?.transactions?.last_successful_update ?? null)
      .catch(() => null);
    if (now && now !== before) return true;
  }

  // Still pulling. The next run will collect it.
  return false;
}

/** Sync one linked institution. Never throws — a bad Item is reported, not fatal. */
export async function syncItem(
  itemRowId: string,
  opts: { refresh?: boolean } = {},
): Promise<SyncReport> {
  const [item] = await db
    .select()
    .from(plaidItems)
    .where(eq(plaidItems.id, itemRowId))
    .limit(1);

  const report: SyncReport = {
    institution: item?.institutionName ?? "Unknown",
    added: 0,
    updated: 0,
    removed: 0,
    alreadyCovered: 0,
    duplicates: 0,
    classified: 0,
    restarts: 0,
    addedIds: [],
    refreshed: false,
  };

  if (!item) return { ...report, error: "That linked bank no longer exists." };

  try {
    const client = plaidClient();
    const accessToken = decryptToken(item.accessTokenEncrypted);

    /*
     * Fresh data first. Skipped only when a caller explicitly opts out — a
     * backfill of old history has nothing to gain from it and would pay the
     * wait for nothing.
     */
    if (opts.refresh !== false) {
      report.refreshed = await refreshFromBank(client, accessToken);
    }

    // Plaid account_id -> our account row.
    const linked = await db
      .select({
        id: accounts.id,
        plaidAccountId: accounts.plaidAccountId,
      })
      .from(accounts)
      .where(
        and(eq(accounts.plaidItemId, item.id), isNotNull(accounts.plaidAccountId)),
      );
    const accountByPlaidId = new Map(
      linked.map((a) => [a.plaidAccountId!, a.id]),
    );

    /*
     * Balances first. They are the only stock the ledger holds — everything
     * else is flows — and they are what makes "do I have a buffer" answerable
     * rather than theoretical. A failure here must not stop the transaction
     * sync, which is the part that matters.
     */
    try {
      const balances = await client.accountsBalanceGet({
        access_token: accessToken,
      });
      for (const a of balances.data.accounts) {
        const current = a.balances.current;
        if (current === null || current === undefined) continue;
        await db
          .update(accounts)
          .set({
            // Plaid reports a card's balance as a positive amount owed.
            balanceCents: Math.round(current * 100),
            availableCents:
              a.balances.available === null || a.balances.available === undefined
                ? null
                : Math.round(a.balances.available * 100),
            balanceUpdatedAt: new Date(),
          })
          .where(eq(accounts.plaidAccountId, a.account_id));

        // Also keep the day's figure, so net worth has a line rather than
        // only a latest value that every sync overwrites.
        const linkedAccount = linked.find((l) => l.plaidAccountId === a.account_id);
        if (linkedAccount) {
          await recordBalance(linkedAccount.id, Math.round(current * 100));
        }
      }
    } catch (err) {
      console.error("balance refresh failed (continuing with transactions)", err);
    }

    const covered = new Map<string, CoveredRange[]>();
    for (const a of linked) covered.set(a.id, await coveredRangesFor(a.id));

    /*
     * Pagination can be invalidated mid-flight.
     *
     * If the account's data changes while we are walking pages, Plaid returns
     * TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION and requires the loop to
     * restart rather than continue — the cursor we hold no longer describes a
     * consistent view. This is not rare on a freshly linked Item, where the
     * initial backfill is still landing while the first sync runs, and it is
     * why a new connection can otherwise sit at zero transactions
     * indefinitely: every attempt dies at the same point.
     *
     * Restarting is safe to do repeatedly. `plaid_transaction_id` is unique,
     * so replayed rows update in place instead of duplicating, and the last
     * resort — starting from no cursor at all — is a full resync rather than a
     * corruption.
     */
    const MAX_RESTARTS = 3;
    let restarts = 0;
    let startCursor = item.cursor ?? undefined;

    for (;;) {
      let cursor = startCursor;
      let hasMore = true;
      const insertedIds: string[] = [];

      try {
        while (hasMore) {
          const res = await client.transactionsSync({
            access_token: accessToken,
            ...(cursor ? { cursor } : {}),
          });
          const data = res.data;

          await applyRemoved(data.removed, report);
          await applyUpserts(
            [...data.added, ...data.modified],
            accountByPlaidId,
            covered,
            report,
            insertedIds,
          );

          hasMore = data.has_more;
          cursor = data.next_cursor;

          /*
           * Classified per page rather than once at the end. A first sync on a
           * fresh account can pull two years of history across many pages, and
           * the request has a time limit — finishing the work in pieces means a
           * timeout leaves categorized rows behind instead of a heap of
           * unclassified ones. Anything stranded is recoverable from
           * "Categorize unsorted".
           */
          if (insertedIds.length > 0) {
            const result = await classifyTransactions(insertedIds.splice(0));
            report.classified +=
              result.byRule + result.byLlm + result.queuedForReview;
          }

          /*
           * The cursor advances only after this page's rows *and* their
           * categories are committed. If the next page fails, the next run
           * resumes here rather than replaying everything — and because the
           * page is already written, resuming cannot skip it either.
           */
          await db
            .update(plaidItems)
            .set({
              cursor,
              lastSyncedAt: new Date(),
              status: "active",
              errorCode: null,
            })
            .where(eq(plaidItems.id, item.id));
        }
        break;
      } catch (err) {
        if (
          plaidErrorCode(err) !== "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" ||
          restarts >= MAX_RESTARTS
        ) {
          throw err;
        }

        restarts += 1;
        /*
         * Second and later attempts start from scratch. Resuming from the same
         * cursor that just failed tends to fail the same way; a full replay
         * costs bandwidth and dedupes to nothing.
         */
        startCursor = restarts === 1 ? item.cursor ?? undefined : undefined;
        report.restarts = restarts;
      }
    }

    return report;
  } catch (err) {
    const code = plaidErrorCode(err);

    // The login has to be repaired by the user; everything else is transient.
    if (code === "ITEM_LOGIN_REQUIRED") {
      await db
        .update(plaidItems)
        .set({ status: "needs_reauth", errorCode: code })
        .where(eq(plaidItems.id, item.id));
    } else if (code) {
      await db
        .update(plaidItems)
        .set({ errorCode: code })
        .where(eq(plaidItems.id, item.id));
    }

    return { ...report, error: plaidErrorMessage(err) };
  }
}

/**
 * Plaid removes a transaction when the bank reverses it, and also when a
 * pending charge is superseded by its posted version. Deleting is right in both
 * cases — but never for a row the user has touched, which is deleted from the
 * ledger's point of view but not from theirs.
 */
async function applyRemoved(
  removed: RemovedTransaction[],
  report: SyncReport,
): Promise<void> {
  for (const r of removed) {
    if (!r.transaction_id) continue;
    const gone = await db
      .delete(transactions)
      .where(
        and(
          eq(transactions.plaidTransactionId, r.transaction_id),
          sql`${transactions.classificationSource} <> 'manual'`,
        ),
      )
      .returning({ id: transactions.id });
    report.removed += gone.length;
  }
}

async function applyUpserts(
  incoming: PlaidTransaction[],
  accountByPlaidId: Map<string, string>,
  covered: Map<string, CoveredRange[]>,
  report: SyncReport,
  insertedIds: string[],
): Promise<void> {
  for (const t of incoming) {
    const accountId = accountByPlaidId.get(t.account_id);
    // An account the user chose not to link. Plaid still returns it.
    if (!accountId) continue;

    if (isCovered(t.date, covered.get(accountId) ?? [])) {
      report.alreadyCovered += 1;
      continue;
    }

    const amountCents = toLedgerCents(t.amount);
    const rawDescription = describe(t);

    /*
     * A modified transaction is the same money with better information — a
     * pending charge that settled at a different amount, or a description the
     * bank filled in later. Update in place so the ledger row keeps its id,
     * its category and any answer the user gave it.
     */
    const [existing] = await db
      .select({
        id: transactions.id,
        source: transactions.classificationSource,
      })
      .from(transactions)
      .where(eq(transactions.plaidTransactionId, t.transaction_id))
      .limit(1);

    if (existing) {
      await db
        .update(transactions)
        .set({
          postedOn: t.date,
          amountCents,
          rawDescription,
          status: t.pending ? "pending" : "cleared",
          dedupeHash: await dedupeHash({
            accountId,
            postedOn: t.date,
            amountCents,
            normalizedDescription: normalizeDescription(rawDescription),
          }),
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, existing.id));
      report.updated += 1;
      continue;
    }

    const hash = await dedupeHash({
      accountId,
      postedOn: t.date,
      amountCents,
      normalizedDescription: normalizeDescription(rawDescription),
    });

    const inserted = await db
      .insert(transactions)
      .values({
        accountId,
        postedOn: t.date,
        amountCents,
        rawDescription,
        currency: t.iso_currency_code ?? "USD",
        dedupeHash: hash,
        plaidTransactionId: t.transaction_id,
        entrySource: "statement",
        status: t.pending ? "pending" : "cleared",
      })
      /*
       * Second line of defence behind the cutoff: if this exact row was
       * already imported from a statement, the fingerprints collide and the
       * insert is skipped rather than duplicating the charge.
       */
      .onConflictDoNothing({ target: transactions.dedupeHash })
      .returning({ id: transactions.id });

    if (inserted[0]) {
      insertedIds.push(inserted[0].id);
      report.addedIds.push(inserted[0].id);
      report.added += 1;
    } else {
      report.duplicates += 1;
    }
  }
}

/** Sync every linked institution that is not disconnected. */
export async function syncAllItems(
  opts: { refresh?: boolean } = {},
): Promise<SyncReport[]> {
  const items = await db
    .select({ id: plaidItems.id })
    .from(plaidItems)
    .where(sql`${plaidItems.status} <> 'disconnected'`);

  const reports: SyncReport[] = [];
  for (const item of items) reports.push(await syncItem(item.id, opts));
  return reports;
}
