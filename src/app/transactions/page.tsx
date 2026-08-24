import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { db } from "@/db";
import { transactions, categories, accounts } from "@/db/schema";
import { and, desc, eq, ne, sql, or, ilike, gte, lte, type SQL } from "drizzle-orm";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { TransactionRow } from "@/components/transaction-row";
import { REVIEW_THRESHOLD } from "@/lib/classify";
import { reclassifyPendingAction, reapplyRulesAction } from "../actions";
import { formatCents } from "@/lib/money";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    category?: string;
    review?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}) {
  await requireAuth();
  const params = await searchParams;

  const page = Math.max(1, Number(params.page ?? 1) || 1);
  const filters: SQL[] = [];

  if (params.q) {
    const needle = `%${params.q}%`;
    const match = or(
      ilike(transactions.rawDescription, needle),
      ilike(transactions.merchant, needle),
    );
    if (match) filters.push(match);
  }
  if (params.category) {
    filters.push(eq(categories.slug, params.category));
  }
  if (params.review === "1") {
    filters.push(
      sql`${transactions.classificationConfidence} < ${REVIEW_THRESHOLD}`,
    );
    filters.push(ne(transactions.classificationSource, "manual"));
  }
  if (params.from) filters.push(gte(transactions.postedOn, params.from));
  if (params.to) filters.push(lte(transactions.postedOn, params.to));

  const where = filters.length > 0 ? and(...filters) : undefined;

  const [rows, countRows, categoryOptions] = await Promise.all([
    db
      .select({
        id: transactions.id,
        postedOn: transactions.postedOn,
        amountCents: transactions.amountCents,
        rawDescription: transactions.rawDescription,
        merchant: transactions.merchant,
        categoryId: transactions.categoryId,
        categoryName: categories.name,
        categorySlug: categories.slug,
        categoryColor: categories.color,
        source: transactions.classificationSource,
        confidence: transactions.classificationConfidence,
        reason: transactions.classificationReason,
        isTransfer: transactions.isTransfer,
        accountName: accounts.name,
      })
      .from(transactions)
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .leftJoin(accounts, eq(transactions.accountId, accounts.id))
      .where(where)
      .orderBy(desc(transactions.postedOn), desc(transactions.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db
      .select({
        count: sql<string>`count(*)`,
        net: sql<string>`COALESCE(SUM(${transactions.amountCents}), 0)`,
      })
      .from(transactions)
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .where(where),
    db
      .select({
        id: categories.id,
        name: categories.name,
        slug: categories.slug,
        parentId: categories.parentId,
      })
      .from(categories)
      .orderBy(categories.sortOrder),
  ]);

  // Only leaf categories are assignable — parents are groupings.
  const parentIds = new Set(
    categoryOptions.map((c) => c.parentId).filter((v): v is string => Boolean(v)),
  );
  const assignable = categoryOptions.filter((c) => !parentIds.has(c.id));

  const total = Number(countRows[0]?.count ?? 0);
  const net = Number(countRows[0]?.net ?? 0);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <PageHeader
        title="Transactions"
        subtitle={
          total > 0 ? (
            <>
              {total.toLocaleString()} matching · net{" "}
              <span className="figure">{formatCents(net, { signed: true })}</span>
            </>
          ) : undefined
        }
        actions={
          <>
            <form action={reapplyRulesAction}>
              <button
                type="submit"
                className="btn"
                title="Apply every rule across the whole ledger. Your manual choices are never overwritten."
              >
                Re-apply rules
              </button>
            </form>
            <form action={reclassifyPendingAction}>
              <button
                type="submit"
                className="btn"
                title="Categorize anything still unsorted."
              >
                Categorize unsorted
              </button>
            </form>
          </>
        }
      />

      <Card className="mb-4">
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <label htmlFor="q" className="mb-1 block text-xs font-medium">
              Search
            </label>
            <input
              id="q"
              name="q"
              defaultValue={params.q ?? ""}
              placeholder="Merchant or description"
              className="field"
            />
          </div>
          <div>
            <label htmlFor="category" className="mb-1 block text-xs font-medium">
              Category
            </label>
            <select
              id="category"
              name="category"
              defaultValue={params.category ?? ""}
              className="field"
            >
              <option value="">All</option>
              {assignable.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="from" className="mb-1 block text-xs font-medium">
              From
            </label>
            <input
              id="from"
              name="from"
              type="date"
              defaultValue={params.from ?? ""}
              className="field"
            />
          </div>
          <div>
            <label htmlFor="to" className="mb-1 block text-xs font-medium">
              To
            </label>
            <input
              id="to"
              name="to"
              type="date"
              defaultValue={params.to ?? ""}
              className="field"
            />
          </div>
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-5">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="review"
                value="1"
                defaultChecked={params.review === "1"}
              />
              Only low-confidence
            </label>
            <button type="submit" className="btn ml-auto">
              Apply
            </button>
            <Link href="/transactions" className="btn">
              Clear
            </Link>
          </div>
        </form>
      </Card>

      {rows.length === 0 ? (
        <EmptyState title="No transactions match">
          Adjust the filters, or{" "}
          <Link
            href="/upload"
            className="text-[var(--color-accent)] underline underline-offset-4"
          >
            import a statement
          </Link>
          .
        </EmptyState>
      ) : (
        <Card className="!p-0">
          <ul className="divide-y divide-[var(--color-border)]">
            {rows.map((t) => (
              <TransactionRow key={t.id} txn={t} categories={assignable} />
            ))}
          </ul>
        </Card>
      )}

      {pageCount > 1 ? (
        <nav className="mt-4 flex items-center justify-between text-sm">
          <PageLink params={params} page={page - 1} disabled={page <= 1}>
            ← Previous
          </PageLink>
          <span className="text-[var(--color-ink-muted)]">
            Page {page} of {pageCount}
          </span>
          <PageLink
            params={params}
            page={page + 1}
            disabled={page >= pageCount}
          >
            Next →
          </PageLink>
        </nav>
      ) : null}
    </>
  );
}

function PageLink({
  params,
  page,
  disabled,
  children,
}: {
  params: Record<string, string | undefined>;
  page: number;
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled) {
    return <span className="text-[var(--color-ink-faint)]">{children}</span>;
  }
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v && k !== "page") search.set(k, v);
  }
  search.set("page", String(page));
  return (
    <Link
      href={`/transactions?${search.toString()}`}
      className="text-[var(--color-accent)] underline underline-offset-4"
    >
      {children}
    </Link>
  );
}
