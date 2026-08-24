import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import {
  assignableCategories,
  merchantHistory,
  popularCategories,
  reviewQueue,
} from "@/lib/review-queue";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { ReviewQueue } from "@/components/review-queue";
import { triageAction } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function ReviewQueuePage() {
  await requireAuth();

  const [items, categories, popular] = await Promise.all([
    reviewQueue(),
    assignableCategories(),
    popularCategories(),
  ]);

  /*
   * Loaded for the whole queue in one query rather than per item. The ranking
   * is the reason the keyboard is faster than a dropdown, and a round trip
   * between keystrokes would give that back.
   */
  const merchants = [...new Set(items.map((i) => i.merchant).filter(Boolean))] as string[];
  const history = Object.fromEntries(await merchantHistory(merchants));

  if (items.length === 0) {
    return (
      <>
        <PageHeader
          title="Answer the queue"
          subtitle="Transactions the ledger could not place on its own."
        />
        <EmptyState title="Nothing is waiting">
          Every transaction has a category the ledger is confident about.{" "}
          <Link
            href="/transactions"
            className="text-[var(--color-accent)] underline underline-offset-4"
          >
            Browse them
          </Link>
          .
        </EmptyState>
      </>
    );
  }

  const total = items.reduce((sum, i) => sum + Math.abs(i.amountCents), 0);

  return (
    <>
      <PageHeader
        title="Answer the queue"
        subtitle="Transactions the ledger could not place on its own, largest first."
      />

      <Card className="mb-4">
        <p className="text-sm text-[var(--color-ink-muted)]">
          {/*
            Said plainly because it changes how much care each answer deserves.
            These rows are *already* in the totals — the month is not wrong
            while they sit here, it is just attributed to the wrong places.
          */}
          These {items.length} already count toward your totals — answering
          decides which category they land in, not whether they are spending.
          Largest first, because a misfiled ${Math.round(total / 100).toLocaleString()} moves
          a decision and a misfiled coffee does not.
        </p>
      </Card>

      <ReviewQueue
        items={items}
        categories={categories}
        merchantHistory={history}
        popular={popular}
        onAnswer={triageAction}
      />
    </>
  );
}
