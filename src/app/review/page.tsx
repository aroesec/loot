import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { listPending, listReconciled } from "@/lib/reconcile";
import { reviewQueueCount } from "@/lib/review-queue";
import { formatCents } from "@/lib/money";
import { PageHeader, Card, EmptyState, Money } from "@/components/ui";
import { unmergeAction, clearPendingAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  await requireAuth();

  const [pending, reconciled, queued] = await Promise.all([
    listPending(),
    listReconciled(),
    reviewQueueCount(),
  ]);

  const adjusted = reconciled.filter((r) => r.loggedAmountCents !== null);

  return (
    <>
      <PageHeader
        title="Review"
        subtitle="Purchases you logged by voice, and how they lined up with your statements."
      />

      {/*
        The queue is the other half of reviewing, and the half with a backlog:
        reconciliation resolves itself when a statement arrives, while an
        unanswered category sits in a total indefinitely.
      */}
      {queued > 0 ? (
        <Card className="mb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              <strong>{queued}</strong>{" "}
              {queued === 1 ? "transaction is" : "transactions are"} waiting on a
              category. They already count toward your totals — answering decides
              where.
            </p>
            <Link
              href="/review/queue"
              className="shrink-0 text-sm text-[var(--color-accent)] underline underline-offset-4"
            >
              Answer them
            </Link>
          </div>
        </Card>
      ) : null}

      {adjusted.length > 0 ? (
        <Card className="mb-4 border-[var(--color-warning)] bg-[var(--color-warning-soft)]">
          <p className="text-sm">
            <strong>{adjusted.length}</strong>{" "}
            {adjusted.length === 1 ? "match" : "matches"} changed an amount you
            had logged — usually a tip added after you paid. Worth a glance
            below to confirm they were the same purchase.
          </p>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="text-lg">Waiting on a statement</h2>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            These already count toward the month. When a statement containing
            them is imported they will be matched, not added again.
          </p>

          {pending.length === 0 ? (
            <p className="mt-4 text-sm text-[var(--color-ink-faint)]">
              Nothing pending.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-[var(--color-border)]">
              {pending.map((p) => (
                <li key={p.id} className="flex items-baseline justify-between gap-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate text-sm">
                      {p.merchant ?? p.rawDescription}
                    </span>
                    <span className="figure text-xs text-[var(--color-ink-faint)]">
                      {p.postedOn}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <Money cents={p.amountCents} className="text-sm" />
                    <form action={clearPendingAction}>
                      <input type="hidden" name="transactionId" value={p.id} />
                      <button
                        type="submit"
                        className="text-xs text-[var(--color-ink-faint)] underline underline-offset-4 hover:text-[var(--color-ink)]"
                        title="Stop waiting for a statement to confirm this one."
                      >
                        Mark settled
                      </button>
                    </form>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="text-lg">Matched to a statement</h2>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            Each of these was logged by voice first, then confirmed by a
            statement. One transaction, not two.
          </p>

          {reconciled.length === 0 ? (
            <p className="mt-4 text-sm text-[var(--color-ink-faint)]">
              Nothing matched yet.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-[var(--color-border)]">
              {reconciled.map((r) => (
                <li key={r.id} className="py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-sm">
                      {r.merchant ?? r.rawDescription}
                    </span>
                    <span className="shrink-0 text-right">
                      <Money cents={r.amountCents} className="text-sm" />
                      {r.loggedAmountCents !== null ? (
                        <span className="figure block text-xs text-[var(--color-ink-faint)]">
                          you logged {formatCents(r.loggedAmountCents)}
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                    Matched because {r.reconciliationNote}.
                  </p>
                  <form action={unmergeAction} className="mt-1.5">
                    <input type="hidden" name="transactionId" value={r.id} />
                    <button
                      type="submit"
                      className="text-xs text-[var(--color-ink-faint)] underline underline-offset-4 hover:text-[var(--color-negative)]"
                      title="Split these back into two separate transactions."
                    >
                      Not the same purchase — split them
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {pending.length === 0 && reconciled.length === 0 ? (
        <EmptyState title="Nothing to review">
          Once you start telling Claude about purchases — &ldquo;I just bought
          coffee&rdquo; — they show up here while they wait for a statement to
          confirm them.{" "}
          <Link href="/settings" className="text-[var(--color-accent)] underline underline-offset-4">
            Set up the MCP connection
          </Link>
          .
        </EmptyState>
      ) : null}
    </>
  );
}
