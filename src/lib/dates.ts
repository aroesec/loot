/**
 * Period boundaries, with no database behind them.
 *
 * Split out of `ledger.ts` for the same reason `match.ts` was split out of
 * `rules.ts`: that module imports `@/db` and therefore the whole env schema,
 * which puts it out of reach of unit tests. These decide which transactions
 * land in which total, so they are worth testing directly — an off-by-one here
 * does not throw, it silently attributes money to the wrong month.
 *
 * Everything is built from `Date.UTC`. A local-time construction shifts the
 * boundary by a day for anyone west of UTC, moving the first and last day of
 * every month into the neighbouring one.
 */

export type MonthKey = string; // "2026-03"

export function monthBounds(month: MonthKey): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y!, m! - 1, 1));
  const end = new Date(Date.UTC(y!, m!, 0)); // day 0 of next month = last day
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

export function yearBounds(year: number): { start: string; end: string } {
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

export function currentMonth(): MonthKey {
  return new Date().toISOString().slice(0, 7);
}

export function shiftMonth(month: MonthKey, delta: number): MonthKey {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export function monthLabel(month: MonthKey): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

// ---------------------------------------------------------------------------
// Monthly summary
// ---------------------------------------------------------------------------
