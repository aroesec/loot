import Link from "next/link";
import { qualityIssues, profileGaps } from "@/lib/quality";
import { formatCents } from "@/lib/money";

/**
 * A standing prompt for the things that quietly distort every number.
 *
 * Rendered in the layout rather than on one page, because both problems it
 * covers are invisible by construction. A misclassified row sits in a total
 * looking ordinary; a missing household size makes every benchmark comparison
 * wrong without anything appearing broken. Neither will be found by someone who
 * does not already suspect it, so the app has to raise them.
 *
 * Kept to one line and dismissible by acting on it. A banner that cannot be
 * cleared is one people learn to read past.
 */
export async function DataHealth() {
  const [issues, gaps] = await Promise.all([qualityIssues(), profileGaps()]);
  if (issues.length === 0 && gaps.length === 0) return null;

  // The costliest issue by amount, since one misfiled mortgage payment moves a
  // decision more than fifty miscategorized coffees.
  const worst = issues[0];
  const gap = gaps[0];

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-4 py-2.5 text-sm">
      {worst ? (
        <Link href={worst.href} className="flex items-center gap-2 hover:underline">
          <span aria-hidden className="inline-block size-2 rounded-full bg-[var(--color-warning)]" />
          <span>
            {worst.summary}
            <span className="ml-1.5 text-[var(--color-ink-muted)]">
              {formatCents(worst.amountCents)}
            </span>
          </span>
        </Link>
      ) : null}

      {gap ? (
        <Link href={gap.href} className="flex items-center gap-2 hover:underline">
          <span aria-hidden className="inline-block size-2 rounded-full bg-[var(--color-accent)]" />
          <span>{gap.prompt}</span>
        </Link>
      ) : null}

      {issues.length + gaps.length > 2 ? (
        <Link
          href="/review"
          className="ml-auto text-xs text-[var(--color-ink-muted)] hover:underline"
        >
          {issues.length + gaps.length - 2} more
        </Link>
      ) : null}
    </div>
  );
}
