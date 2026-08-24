import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { ledgerMode, businessName } from "@/lib/mode";
import { monthlyPl, quarterlyPl, yearlyPl, type PlLine } from "@/lib/pl";
import { availableMonths, currentMonth, monthLabel } from "@/lib/ledger";
import { formatCents } from "@/lib/money";
import { PageHeader, Card, Stat, EmptyState } from "@/components/ui";
import { PeriodPicker } from "@/components/period-picker";

export const dynamic = "force-dynamic";

const SECTION_LABELS: Record<string, string> = {
  revenue: "Revenue",
  cogs: "Cost of Goods Sold",
  opex: "Operating Expenses",
  owner_equity: "Owner Equity",
  other: "Other",
};

function Section({ title, lines, note }: { title: string; lines: PlLine[]; note?: string }) {
  if (lines.length === 0) return null;
  const total = lines.reduce((a, l) => a + l.amountCents, 0);

  return (
    <div className="border-b border-[var(--color-border)] last:border-0">
      <div className="flex items-baseline justify-between px-5 py-2.5">
        <h3 className="text-sm font-medium">{title}</h3>
        <span className="figure text-sm font-medium">{formatCents(total)}</span>
      </div>
      {note ? (
        <p className="px-5 pb-2 text-xs text-[var(--color-ink-muted)]">{note}</p>
      ) : null}
      <ul>
        {lines.map((l) => (
          <li
            key={l.slug}
            className="flex flex-wrap items-baseline justify-between gap-x-3 px-5 py-1.5 text-sm"
          >
            <Link
              href={`/transactions?category=${encodeURIComponent(l.slug)}`}
              className="hover:underline"
            >
              {l.name}
              {l.scheduleCLine ? (
                <span className="ml-2 text-xs text-[var(--color-ink-faint)]">
                  Sch. C {l.scheduleCLine.split(" — ")[0]}
                </span>
              ) : null}
            </Link>
            <span className="flex items-baseline gap-3">
              {/*
                Shown only when it is not the whole amount. A "100%" badge on
                every line is noise; a "50%" badge is the thing you need to see.
              */}
              {l.deductiblePct !== null && l.deductiblePct < 100 ? (
                <span className="chip text-xs">{l.deductiblePct}% deductible</span>
              ) : null}
              <span className="figure">{formatCents(l.amountCents)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default async function ProfitAndLossPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; period?: string }>;
}) {
  await requireAuth();
  const [mode, name] = await Promise.all([ledgerMode(), businessName()]);

  if (mode !== "business") {
    return (
      <>
        <PageHeader title="Profit & Loss" />
        <EmptyState title="This ledger is set to personal">
          A P&amp;L needs the business chart of accounts — revenue, cost of
          goods sold and operating expenses. Switch in{" "}
          <Link
            href="/settings"
            className="text-[var(--color-accent)] underline underline-offset-4"
          >
            Settings
          </Link>
          .
        </EmptyState>
      </>
    );
  }

  const params = await searchParams;
  const months = await availableMonths();
  const month = params.month ?? months[0] ?? currentMonth();
  const year = Number(month.slice(0, 4));
  const period = params.period ?? "month";

  const pl =
    period === "year"
      ? await yearlyPl(year)
      : await monthlyPl(month);
  const quarters = period === "year" ? await quarterlyPl(year) : [];

  const revenue = pl.lines.filter((l) => l.section === "revenue");
  const cogs = pl.lines.filter((l) => l.section === "cogs");
  const opex = pl.lines.filter((l) => l.section === "opex");
  const equity = pl.lines.filter((l) => l.section === "owner_equity");

  const pct = (v: number | null) =>
    v === null ? "—" : `${(v * 100).toFixed(0)}%`;

  return (
    <>
      <PageHeader
        title={name ? `${name} — Profit & Loss` : "Profit & Loss"}
        subtitle={period === "year" ? String(year) : monthLabel(month)}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/* carry keeps the month/year toggle from resetting on change. */}
            <PeriodPicker
              name="month"
              value={month}
              label="Month"
              options={months.map((m) => ({ value: m, label: monthLabel(m) }))}
              carry={{ period }}
            />
            <Link
              href={`/pl?month=${month}&period=month`}
              className={`btn ${period !== "year" ? "btn-primary" : ""}`}
            >
              Month
            </Link>
            <Link
              href={`/pl?month=${month}&period=year`}
              className={`btn ${period === "year" ? "btn-primary" : ""}`}
            >
              Year
            </Link>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Revenue" value={formatCents(pl.revenueCents)} tone="positive" />
        <Stat
          label="Gross profit"
          value={formatCents(pl.grossProfitCents)}
          detail={<>{pct(pl.grossMargin)} margin</>}
        />
        <Stat
          label="Net profit"
          value={formatCents(pl.netProfitCents)}
          tone={pl.netProfitCents >= 0 ? "positive" : "negative"}
          detail={<>{pct(pl.netMargin)} margin</>}
        />
        <Stat
          label="Deductible expenses"
          value={formatCents(pl.deductibleCents)}
          detail={<>of {formatCents(pl.cogsCents + pl.opexCents)} total</>}
        />
      </div>

      <Card className="mt-4 !p-0">
        <Section
          title={SECTION_LABELS.revenue!}
          lines={revenue}
          note="Money from customers. Refunds issued reduce this rather than counting as an expense."
        />
        <Section
          title={SECTION_LABELS.cogs!}
          lines={cogs}
          note="What it cost to deliver what was sold. Revenue minus this is gross profit."
        />
        <Section
          title={SECTION_LABELS.opex!}
          lines={opex}
          note="The cost of being in business regardless of what sold."
        />
      </Card>

      {equity.length > 0 ? (
        <Card className="mt-4 !p-0">
          <Section
            title={SECTION_LABELS.owner_equity!}
            lines={equity}
            note="Outside the P&L by definition. An owner's draw is profit being withdrawn, not a cost of earning it — counting it as an expense would understate profit and overstate deductions."
          />
        </Card>
      ) : null}

      {period === "year" && quarters.length > 0 ? (
        <Card className="mt-4">
          <h2 className="mb-1 text-lg">By quarter</h2>
          <p className="mb-3 text-sm text-[var(--color-ink-muted)]">
            Estimated tax is paid on this cadence, and it is owed on profit
            rather than on cashflow.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left">
                  <th className="py-2 font-medium">Quarter</th>
                  <th className="py-2 text-right font-medium">Revenue</th>
                  <th className="py-2 text-right font-medium">Expenses</th>
                  <th className="py-2 text-right font-medium">Net profit</th>
                </tr>
              </thead>
              <tbody>
                {quarters.map((q) => (
                  <tr
                    key={q.label}
                    className="border-b border-[var(--color-border)] last:border-0"
                  >
                    <td className="py-2">{q.label}</td>
                    <td className="figure py-2 text-right">
                      {formatCents(q.revenueCents)}
                    </td>
                    <td className="figure py-2 text-right">
                      {formatCents(q.cogsCents + q.opexCents)}
                    </td>
                    <td className="figure py-2 text-right font-medium">
                      {formatCents(q.netProfitCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <p className="mt-4 text-xs text-[var(--color-ink-muted)]">
        Deductible percentages are defaults for organizing records, not tax
        advice. Rates change and the right share for a home office or a shared
        phone line is specific to you — edit them in Settings.
      </p>
    </>
  );
}
