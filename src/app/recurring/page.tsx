import { requireAuth } from "@/lib/auth";
import { db } from "@/db";
import { recurringSeries, categories } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { formatCents } from "@/lib/money";
import { PageHeader, Card, EmptyState, Stat } from "@/components/ui";
import { refreshRecurringAction, setSeriesStatusAction } from "../actions";

export const dynamic = "force-dynamic";

const CADENCE_LABEL: Record<string, string> = {
  weekly: "weekly",
  biweekly: "every two weeks",
  monthly: "monthly",
  quarterly: "quarterly",
  annual: "yearly",
  irregular: "irregularly",
};

export default async function RecurringPage() {
  await requireAuth();

  const rows = await db
    .select({
      id: recurringSeries.id,
      merchant: recurringSeries.merchant,
      cadence: recurringSeries.cadence,
      typicalAmountCents: recurringSeries.typicalAmountCents,
      lastAmountCents: recurringSeries.lastAmountCents,
      annualizedCents: recurringSeries.annualizedCents,
      priceChangePct: recurringSeries.priceChangePct,
      status: recurringSeries.status,
      lastSeenOn: recurringSeries.lastSeenOn,
      nextExpectedOn: recurringSeries.nextExpectedOn,
      occurrences: recurringSeries.occurrences,
      categoryName: categories.name,
    })
    .from(recurringSeries)
    .leftJoin(categories, eq(recurringSeries.categoryId, categories.id))
    .orderBy(desc(recurringSeries.annualizedCents));

  const active = rows.filter((r) => r.status === "active");
  const inactive = rows.filter((r) => r.status !== "active");
  const annualTotal = active.reduce((a, r) => a + r.annualizedCents, 0);
  const monthlyTotal = Math.round(annualTotal / 12);
  const hikes = active.filter((r) => (r.priceChangePct ?? 0) >= 8);

  return (
    <>
      <PageHeader
        title="Recurring"
        subtitle="Charges that repeat on a regular schedule for a regular amount."
        actions={
          <form action={refreshRecurringAction}>
            <button type="submit" className="btn">Re-scan</button>
          </form>
        }
      />

      {rows.length === 0 ? (
        <EmptyState title="Nothing detected yet">
          A merchant needs at least three charges on a steady schedule, for a
          steady amount, before it counts as recurring. Import a few months of
          statements and it will fill in.
        </EmptyState>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Per year" value={formatCents(annualTotal)} detail={`${active.length} active`} />
            <Stat label="Per month" value={formatCents(monthlyTotal)} detail="averaged across cadences" />
            <Stat
              label="Price increases"
              value={String(hikes.length)}
              tone={hikes.length > 0 ? "warning" : "neutral"}
              detail={hikes.length > 0 ? "up 8% or more since the first charge" : "none found"}
            />
          </div>

          <Card className="mt-4 !p-0">
            <ul className="divide-y divide-[var(--color-border)]">
              {active.map((r) => (
                <li key={r.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-medium">{r.merchant}</span>
                      {r.categoryName ? (
                        <span className="ml-2 text-xs text-[var(--color-ink-faint)]">{r.categoryName}</span>
                      ) : null}
                    </div>
                    <div className="flex items-baseline gap-3">
                      <span className="figure text-sm">
                        {formatCents(r.typicalAmountCents)}
                        <span className="text-[var(--color-ink-faint)]"> {CADENCE_LABEL[r.cadence]}</span>
                      </span>
                      <span className="figure text-sm text-[var(--color-ink-muted)]">
                        {formatCents(r.annualizedCents)}/yr
                      </span>
                    </div>
                  </div>

                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-ink-muted)]">
                    <span className="figure">{r.occurrences} charges</span>
                    <span className="figure">last {r.lastSeenOn}</span>
                    {r.nextExpectedOn ? (
                      <span className="figure">next ~{r.nextExpectedOn}</span>
                    ) : null}
                    {r.priceChangePct !== null && Math.abs(r.priceChangePct) >= 5 ? (
                      <span className={`chip ${r.priceChangePct > 0 ? "!border-[var(--color-warning)] !text-[var(--color-warning)]" : "!border-[var(--color-positive)] !text-[var(--color-positive)]"}`}>
                        {r.priceChangePct > 0 ? "▲" : "▼"} {Math.abs(r.priceChangePct).toFixed(0)}% since first charge
                      </span>
                    ) : null}
                    <form action={setSeriesStatusAction} className="ml-auto">
                      <input type="hidden" name="seriesId" value={r.id} />
                      <input type="hidden" name="status" value="paused" />
                      <button type="submit" className="underline underline-offset-4 hover:text-[var(--color-ink)]">
                        Ignore
                      </button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          {inactive.length > 0 ? (
            <Card className="mt-4 !p-0">
              <h2 className="px-5 pt-4 text-lg">Stopped or ignored</h2>
              <ul className="mt-2 divide-y divide-[var(--color-border)]">
                {inactive.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                    <span className="text-[var(--color-ink-muted)]">
                      {r.merchant}
                      <span className="figure ml-2 text-xs text-[var(--color-ink-faint)]">
                        last {r.lastSeenOn}
                      </span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="chip">{r.status === "paused" ? "Ignored" : "Stopped"}</span>
                      <span className="figure text-xs text-[var(--color-ink-muted)]">
                        {formatCents(r.annualizedCents)}/yr
                      </span>
                      <form action={setSeriesStatusAction}>
                        <input type="hidden" name="seriesId" value={r.id} />
                        <input type="hidden" name="status" value="active" />
                        <button type="submit" className="text-xs underline underline-offset-4">
                          Restore
                        </button>
                      </form>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </>
      )}
    </>
  );
}
