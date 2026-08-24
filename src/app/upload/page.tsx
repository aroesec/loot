import { requireAuth } from "@/lib/auth";
import { db } from "@/db";
import { accounts, statements } from "@/db/schema";
import { desc, isNull } from "drizzle-orm";
import { hasLlm } from "@/lib/env";
import { PageHeader, Card } from "@/components/ui";
import { UploadForm } from "@/components/upload-form";

export const dynamic = "force-dynamic";

export default async function UploadPage() {
  await requireAuth();

  const [accountRows, history] = await Promise.all([
    db
      .select({ id: accounts.id, name: accounts.name })
      .from(accounts)
      .where(isNull(accounts.archivedAt))
      .orderBy(accounts.name),
    db
      .select({
        id: statements.id,
        filename: statements.filename,
        status: statements.status,
        sourceKind: statements.sourceKind,
        transactionCount: statements.transactionCount,
        duplicateCount: statements.duplicateCount,
        periodStart: statements.periodStart,
        periodEnd: statements.periodEnd,
        error: statements.error,
        uploadedAt: statements.uploadedAt,
      })
      .from(statements)
      .orderBy(desc(statements.uploadedAt))
      .limit(20),
  ]);

  return (
    <>
      <PageHeader
        title="Import"
        subtitle="Upload a statement whenever you like. Transactions already in the ledger are skipped, so overlapping periods are safe."
      />

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <UploadForm accounts={accountRows} hasLlm={hasLlm} />
        </div>

        <div className="lg:col-span-2">
          <Card>
            <h2 className="mb-3 text-lg">Recent imports</h2>
            {history.length === 0 ? (
              <p className="text-sm text-[var(--color-ink-muted)]">
                Nothing imported yet.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--color-border)]">
                {history.map((s) => (
                  <li key={s.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-medium">
                        {s.filename}
                      </span>
                      <span
                        className={`chip shrink-0 ${
                          s.status === "failed"
                            ? "!border-[var(--color-negative)] !text-[var(--color-negative)]"
                            : ""
                        }`}
                      >
                        {s.status === "failed"
                          ? "Failed"
                          : `${s.transactionCount} added`}
                      </span>
                    </div>
                    <p className="figure mt-0.5 text-xs text-[var(--color-ink-faint)]">
                      {s.sourceKind.toUpperCase()}
                      {s.periodStart && s.periodEnd
                        ? ` · ${s.periodStart} → ${s.periodEnd}`
                        : ""}
                      {s.duplicateCount > 0
                        ? ` · ${s.duplicateCount} skipped`
                        : ""}
                    </p>
                    {s.error ? (
                      <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                        {s.error}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="mt-4">
            <h2 className="mb-2 text-lg">How importing works</h2>
            <ol className="space-y-2 text-sm text-[var(--color-ink-muted)]">
              <li>
                <strong className="text-[var(--color-ink)]">1. Read.</strong> A
                CSV is parsed directly. A PDF or screenshot goes to Claude,
                which reads the transaction table the way you would.
              </li>
              <li>
                <strong className="text-[var(--color-ink)]">2. Dedupe.</strong>{" "}
                Each transaction gets a fingerprint from its date, amount and
                cleaned description. Anything already in the ledger is skipped.
              </li>
              <li>
                <strong className="text-[var(--color-ink)]">
                  3. Categorize.
                </strong>{" "}
                Your rules run first. Only what they miss goes to Claude.
              </li>
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
