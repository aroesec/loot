import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import {
  attributeCardPayments,
  unsettledCharges,
  describeCoverage,
} from "@/lib/reconcile/card-payments";
import { unreconciledByIssuer } from "@/lib/reconcile/debt";
import { formatCents } from "@/lib/money";
import { PageHeader, Card, EmptyState, Bar } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * What each card payment actually paid for.
 *
 * The ledger counts charges when they happen and excludes the payment, which
 * is the only way to avoid counting the same money twice — but it leaves a
 * large payment leaving the account with no visible destination. This puts the
 * two back together without changing either number.
 */
export default async function CardsPage() {
  await requireAuth();

  const [payments, carried, blind] = await Promise.all([
    attributeCardPayments(),
    unsettledCharges(),
    unreconciledByIssuer(),
  ]);

  if (payments.length === 0 && blind.length === 0) {
    return (
      <>
        <PageHeader title="Card payments" />
        <EmptyState title="No card payments to reconcile">
          Link or import a credit card and this shows which charges each
          payment settled.{" "}
          <Link
            href="/upload"
            className="text-[var(--color-accent)] underline underline-offset-4"
          >
            Import a statement
          </Link>
          .
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Card payments"
        subtitle="Which charges each payment settled"
      />

      {blind.length > 0 ? (
        <Card className="mb-4 border-[var(--color-warning)] bg-[var(--color-warning-soft)]">
          <h2 className="text-lg">Link these cards to see what you bought</h2>
          <p className="mt-1 text-sm">
            Their payments are counted as <strong>Debt Payments</strong> so the
            money is not missing from your totals — but that is a stand-in, not
            an answer. Until the card&rsquo;s own transactions are in the ledger,
            nothing can say whether that money went on flights, groceries or
            anything else.
          </p>
          <ul className="mt-3 space-y-1 text-sm">
            {blind.map((b) => (
              <li key={b.issuer} className="flex justify-between gap-3">
                <span>
                  {b.issuer}
                  <span className="ml-2 text-xs text-[var(--color-ink-muted)]">
                    {b.paymentCount} payment{b.paymentCount === 1 ? "" : "s"}
                    {b.earliestPaymentOn
                      ? `, ${b.earliestPaymentOn} to ${b.latestPaymentOn}`
                      : ""}
                  </span>
                </span>
                <span className="figure">{formatCents(b.paymentsCents)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/settings" className="btn btn-primary">
              Connect the bank
            </Link>
            <Link href="/upload" className="btn">
              Import a statement instead
            </Link>
          </div>
        </Card>
      ) : null}

      {carried.length > 0 ? (
        <Card className="mb-4">
          <h2 className="text-sm font-medium">Charged but not yet paid</h2>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            Already counted as spending, but the money has not left a bank
            account yet.
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {carried.map((c) => (
              <li key={c.accountName} className="flex justify-between gap-3">
                <span>
                  {c.accountName}
                  <span className="ml-2 text-xs text-[var(--color-ink-muted)]">
                    {c.count} charges since {c.sinceOn ?? "the beginning"}
                  </span>
                </span>
                <span className="figure">{formatCents(c.amountCents)}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="space-y-4">
        {payments.map((p) => {
          const coverage = describeCoverage(p.coverage);
          const max = p.categories[0]?.amountCents ?? 1;

          return (
            <Card key={p.paymentId}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg">
                  {formatCents(p.amountCents)}
                  <span className="ml-2 text-sm text-[var(--color-ink-muted)]">
                    {p.accountName} · {p.paidOn}
                  </span>
                </h2>
                {coverage ? (
                  <span className="chip" title={coverage.detail}>
                    {coverage.label}
                  </span>
                ) : null}
              </div>

              <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
                Settles {p.chargeCount} charge
                {p.chargeCount === 1 ? "" : "s"} totalling{" "}
                <span className="figure">{formatCents(p.chargesCents)}</span>
                {p.windowStart
                  ? ` from ${p.windowStart} to ${p.windowEnd}`
                  : ` up to ${p.windowEnd}`}
                .
              </p>

              {p.categories.length > 0 ? (
                <ul className="mt-3 space-y-2">
                  {p.categories.map((c) => (
                    <li key={c.slug}>
                      <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                        <Link
                          href={`/transactions?category=${encodeURIComponent(c.slug)}${p.windowStart ? `&from=${p.windowStart}` : ""}&to=${p.windowEnd}`}
                          className="truncate hover:underline"
                        >
                          {c.name}
                          <span className="ml-1.5 text-xs text-[var(--color-ink-faint)]">
                            {c.count}
                          </span>
                        </Link>
                        <span className="figure shrink-0">
                          {formatCents(c.amountCents)}
                        </span>
                      </div>
                      <Bar fraction={c.amountCents / max} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-[var(--color-ink-muted)]">
                  No charges found in this window — the card&rsquo;s history may
                  start after this payment.
                </p>
              )}
            </Card>
          );
        })}
      </div>

      <p className="mt-4 text-xs text-[var(--color-ink-muted)]">
        A payment is attributed to the charges since the previous payment, which
        approximates a statement cycle rather than reproducing it. Coverage well
        above or below 100% means a balance was cleared or carried, not that
        something is wrong.
      </p>
    </>
  );
}
