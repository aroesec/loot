import { requireAuth } from "@/lib/auth";
import { listInsights } from "@/lib/insights";
import { availableMonths, currentMonth, monthLabel } from "@/lib/ledger";
import { hasLlm } from "@/lib/env";
import { formatCents } from "@/lib/money";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { generateInsightsAction, insightStatusAction } from "../actions";

export const dynamic = "force-dynamic";

const SEVERITY: Record<string, { label: string; className: string }> = {
  warning: { label: "Worth acting on", className: "!border-[var(--color-warning)] !text-[var(--color-warning)]" },
  opportunity: { label: "Opportunity", className: "!border-[var(--color-accent)] !text-[var(--color-accent)]" },
  info: { label: "For your info", className: "" },
};

export default async function InsightsPage() {
  await requireAuth();

  const [rows, months] = await Promise.all([listInsights(), availableMonths()]);
  const latest = months[0] ?? currentMonth();

  return (
    <>
      <PageHeader
        title="Insights"
        subtitle={
          hasLlm
            ? "Computed from your ledger, then written up by Claude. Every figure comes from your own numbers."
            : "Computed from your ledger. Add a Claude API key for the written suggestions too."
        }
        actions={
          <form action={generateInsightsAction}>
            <input type="hidden" name="month" value={latest} />
            <button type="submit" className="btn btn-primary">
              Analyze {monthLabel(latest)}
            </button>
          </form>
        }
      />

      {rows.length === 0 ? (
        <EmptyState title="No insights yet">
          Run an analysis on your most recent month. You will get a short list
          of specific, dollar-quantified things worth a look — price increases,
          categories drifting up, budgets slipping.
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {rows.map((i) => {
            const sev = SEVERITY[i.severity] ?? SEVERITY.info!;
            return (
              <li key={i.id}>
                <Card className={i.status === "read" ? "opacity-70" : ""}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1.5 flex flex-wrap items-center gap-2">
                        <span className={`chip ${sev.className}`}>{sev.label}</span>
                        {i.categoryName ? <span className="chip">{i.categoryName}</span> : null}
                        <span className="text-xs text-[var(--color-ink-faint)]">
                          {monthLabel(i.periodMonth.slice(0, 7))}
                        </span>
                      </div>
                      <h2 className="text-lg leading-snug">{i.title}</h2>
                      <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">{i.body}</p>
                    </div>

                    {i.impactCents > 0 ? (
                      <div className="shrink-0 text-right">
                        <div className="figure text-lg">{formatCents(i.impactCents)}</div>
                        <div className="text-xs text-[var(--color-ink-faint)]">a year at stake</div>
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-3 flex gap-3 text-xs">
                    <form action={insightStatusAction}>
                      <input type="hidden" name="insightId" value={i.id} />
                      <input type="hidden" name="status" value="actioned" />
                      <button type="submit" className="underline underline-offset-4 hover:text-[var(--color-accent)]">
                        Done
                      </button>
                    </form>
                    <form action={insightStatusAction}>
                      <input type="hidden" name="insightId" value={i.id} />
                      <input type="hidden" name="status" value="dismissed" />
                      <button type="submit" className="text-[var(--color-ink-faint)] underline underline-offset-4 hover:text-[var(--color-ink)]">
                        Dismiss
                      </button>
                    </form>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
