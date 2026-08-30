import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { ledgerMode, businessName, estimatedTaxRate } from "@/lib/mode";
import { scheduleC, businessYears, type ScheduleCLine } from "@/lib/tax";
import { db } from "@/db";
import { mileageTrips } from "@/db/schema";
import { and, gte, lt } from "drizzle-orm";
import { milesFromTenths, totalDeduction } from "@/lib/mileage";
import { setAside, nextQuarterDue, quarterDueDates } from "@/lib/tax-math";
import { formatCents } from "@/lib/money";
import { PageHeader, Card, EmptyState, Stat } from "@/components/ui";
import { setEstimatedTaxRateAction } from "../actions";

export const dynamic = "force-dynamic";

function LineTable({ lines, showDeductible }: { lines: ScheduleCLine[]; showDeductible: boolean }) {
  return (
    <table className="w-full text-sm">
      <tbody className="divide-y divide-[var(--color-border)]">
        {lines.map((l) => (
          <tr key={l.line ?? "unmapped"} className="align-baseline">
            <td className="py-2 pr-3">
              <span className="figure text-xs text-[var(--color-ink-faint)]">
                {l.line ? l.line.split(" — ")[0] : "—"}
              </span>
            </td>
            <td className="py-2 pr-3">
              <span>{l.line ? l.line.split(" — ").slice(1).join(" — ") : "Not mapped to a line"}</span>
              <span className="block text-xs text-[var(--color-ink-faint)]">
                {l.categories.map((c) => c.name).join(", ")}
              </span>
            </td>
            <td className="figure whitespace-nowrap py-2 pr-3 text-right">
              {formatCents(l.amountCents)}
            </td>
            {showDeductible ? (
              <td className="figure whitespace-nowrap py-2 text-right">
                {l.deductiblePct !== null && l.deductiblePct < 100 ? (
                  <span className="mr-2 chip text-xs">{l.deductiblePct}%</span>
                ) : null}
                {formatCents(l.deductibleCents)}
              </td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function ScheduleCPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  await requireAuth();

  if ((await ledgerMode()) !== "business") {
    return (
      <>
        <PageHeader title="Schedule C" />
        <EmptyState title="This ledger is set to personal">
          Schedule C reports business profit.{" "}
          <Link href="/settings" className="text-[var(--color-accent)] underline underline-offset-4">
            Switch to a business ledger
          </Link>{" "}
          to use it.
        </EmptyState>
      </>
    );
  }

  const params = await searchParams;
  const years = await businessYears();
  const year = Number(params.year) || years[0] || new Date().getFullYear();

  const [summary, name, rate, trips] = await Promise.all([
    scheduleC(year),
    businessName(),
    estimatedTaxRate(),
    /*
     * A half-open range rather than a prefix match: `drove_on` is a real
     * `date`, and Postgres has no `LIKE` for one ("operator does not exist:
     * date ~~ unknown"). The range is what wants the index anyway, and unlike
     * `date_trunc` it can actually use it.
     */
    db
      .select({ milesTenths: mileageTrips.milesTenths, droveOn: mileageTrips.droveOn })
      .from(mileageTrips)
      .where(
        and(
          gte(mileageTrips.droveOn, `${year}-01-01`),
          lt(mileageTrips.droveOn, `${year + 1}-01-01`),
        ),
      ),
  ]);

  const mileage = totalDeduction(trips);

  const owed = setAside(summary.netProfitCents, year, rate);
  const today = new Date().toISOString().slice(0, 10);
  const next = nextQuarterDue(year, today);
  const quarters = quarterDueDates(year);

  return (
    <>
      <PageHeader
        title={name ? `${name} — Schedule C` : "Schedule C"}
        subtitle={`Tax year ${year}`}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {years.map((y) => (
          <Link
            key={y}
            href={`/schedule-c?year=${y}`}
            className={`chip text-sm ${y === year ? "bg-[var(--color-accent-soft)]" : ""}`}
          >
            {y}
          </Link>
        ))}
        <a
          href={`/api/schedule-c?year=${year}`}
          className="ml-auto text-sm text-[var(--color-accent)] underline underline-offset-4"
        >
          Download CSV
        </a>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label="Gross receipts" value={formatCents(summary.grossReceiptsCents)} />
        <Stat label="Deductible expenses" value={formatCents(summary.deductibleCents)} />
        <Stat label="Net profit" value={formatCents(summary.netProfitCents)} />
      </div>

      {mileage.milesTenths > 0 ? (
        <Card className="mb-4">
          <h2 className="text-lg">Mileage — line 9</h2>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            {milesFromTenths(mileage.milesTenths).toLocaleString("en-US")} business
            miles in {year}, rated by the day each trip was driven.{" "}
            <strong>{formatCents(mileage.deductionCents)}</strong>.
          </p>
          <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
            Deliberately not added to the figures above. The standard rate is an
            alternative to deducting what the vehicle actually cost to run — if
            you claim these miles, the fuel and maintenance already counted as
            expenses are not also deductible, and adding the two would overstate
            the deduction.
          </p>
        </Card>
      ) : null}

      <Card className="mb-4">
        <h2 className="text-lg">Income</h2>
        {summary.revenueLines.length ? (
          <LineTable lines={summary.revenueLines} showDeductible={false} />
        ) : (
          <p className="mt-2 text-sm text-[var(--color-ink-faint)]">
            No revenue recorded in {year}.
          </p>
        )}
      </Card>

      <Card className="mb-4">
        <h2 className="text-lg">Expenses</h2>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Face value on the left, what the percentages allow on the right. The
          percentages are defaults for organising records, not a ruling on what
          you can claim.
        </p>
        {summary.expenseLines.length ? (
          <LineTable lines={summary.expenseLines} showDeductible />
        ) : (
          <p className="mt-2 text-sm text-[var(--color-ink-faint)]">
            No expenses recorded in {year}.
          </p>
        )}
      </Card>

      {/*
        Reported rather than absorbed. A category with no Schedule C line is
        money the ledger cannot place on the form, and folding it into "other
        expenses" would be inventing an answer.
      */}
      {summary.unmapped ? (
        <Card className="mb-4 border-[var(--color-warning)] bg-[var(--color-warning-soft)]">
          <h2 className="text-lg">Not mapped to a line</h2>
          <p className="mt-1 text-sm">
            <strong>{formatCents(summary.unmapped.amountCents)}</strong> of
            business spending sits in categories with no Schedule C line, so it
            is not counted in the deductible total above. Recategorize it, or
            decide with your accountant where it belongs.
          </p>
          <div className="mt-2">
            <LineTable lines={[summary.unmapped]} showDeductible />
          </div>
        </Card>
      ) : null}

      {summary.ownerEquityCents > 0 ? (
        <Card className="mb-4">
          <h2 className="text-lg">Owner&rsquo;s draw</h2>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            {formatCents(summary.ownerEquityCents)} withdrawn. This is not an
            expense and does not appear on Schedule C. Paying yourself is profit
            being taken out, not a cost of earning it.
          </p>
        </Card>
      ) : null}

      <Card className="mb-4">
        <h2 className="text-lg">Setting money aside</h2>

        <div className="mt-3 space-y-2 text-sm">
          <div className="flex items-baseline justify-between gap-4">
            <span>
              Self-employment tax
              <span className="block text-xs text-[var(--color-ink-muted)]">
                15.3% of 92.35% of profit, Social Security capped at the wage
                base. This part follows from profit alone.
                {owed.selfEmployment.wageBaseExact
                  ? ""
                  : ` The ${year} wage base is not published in this build, so the cap uses the most recent known figure.`}
              </span>
            </span>
            <span className="figure whitespace-nowrap">
              {formatCents(owed.selfEmployment.totalCents)}
            </span>
          </div>

          <div className="flex items-baseline justify-between gap-4">
            <span>
              Income tax at {rate}%
              <span className="block text-xs text-[var(--color-ink-muted)]">
                Your figure, not a calculation. Applied after deducting half the
                self-employment tax, which is how the return works.
              </span>
            </span>
            <span className="figure whitespace-nowrap">
              {formatCents(owed.incomeTaxCents)}
            </span>
          </div>

          <div className="flex items-baseline justify-between gap-4 border-t border-[var(--color-border)] pt-2">
            <strong>Total to set aside</strong>
            <strong className="figure whitespace-nowrap">
              {formatCents(owed.totalCents)}
              {owed.effectiveRate !== null ? (
                <span className="ml-2 text-xs font-normal text-[var(--color-ink-muted)]">
                  {Math.round(owed.effectiveRate * 100)}% of profit
                </span>
              ) : null}
            </strong>
          </div>
        </div>

        <form action={setEstimatedTaxRateAction} className="mt-4 flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="block text-xs text-[var(--color-ink-muted)]">
              Income tax rate you expect
            </span>
            <input
              type="number"
              name="rate"
              min={0}
              max={60}
              defaultValue={rate}
              className="mt-1 w-24 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1"
            />
          </label>
          <button type="submit" className="btn">
            Save
          </button>
        </form>

        <p className="mt-3 text-xs text-[var(--color-ink-faint)]">
          This is arithmetic on your own ledger, not tax advice. Estimated
          payments depend on your whole return, including income this app never
          sees. Check the figure with someone qualified before relying on it.
        </p>
      </Card>

      <Card>
        <h2 className="text-lg">Quarterly deadlines</h2>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Estimated tax is paid on this cadence, and it is owed on profit rather
          than on what is left in the account. The periods are uneven: the
          second covers two months and the fourth is paid the following January.
        </p>
        <ul className="mt-3 space-y-1 text-sm">
          {quarters.map((q) => (
            <li
              key={q.quarter}
              className={`flex items-baseline justify-between gap-4 ${
                next?.quarter === q.quarter ? "font-medium" : "text-[var(--color-ink-muted)]"
              }`}
            >
              <span>
                Q{q.quarter} · {q.covers}
              </span>
              <span className="figure">
                {q.due}
                {next?.quarter === q.quarter ? " · next" : ""}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
