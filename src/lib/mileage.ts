/**
 * The standard mileage deduction.
 *
 * DB-free, like `tax-math.ts`, and for the same reason: this is arithmetic that
 * ends up on a tax return, so it is worth testing without a database.
 *
 * The `vehicle` category's hint already told people that "mileage records
 * matter" while giving them nowhere to keep them. A mileage log is also the
 * one Schedule C figure that cannot be derived from a bank statement: the
 * deduction comes from miles driven, not from money that moved, so no amount
 * of importing produces it.
 *
 * **Rates change mid-year, and that is the trap.** 2026 ran at 72.5¢ through
 * June and 76¢ from July, and 2022 did the same thing. A rate looked up by
 * year alone is not merely imprecise — it is wrong for half of every year the
 * IRS revises, in a direction that overstates or understates a deduction. So
 * rates are effective-dated periods and are looked up by the date driven.
 *
 * Rates are hardcoded because there is nothing to derive them from. A year the
 * table does not cover falls back to the most recent known rate and says so,
 * rather than presenting a guess with the same confidence as a published
 * figure — the same bargain `wageBase` makes.
 */

/** Business rates, newest first. `from` is inclusive, ISO `YYYY-MM-DD`. */
const RATES: Array<{ from: string; centsPerMile: number }> = [
  { from: "2026-07-01", centsPerMile: 76 },
  { from: "2026-01-01", centsPerMile: 72.5 },
  { from: "2025-01-01", centsPerMile: 70 },
  { from: "2024-01-01", centsPerMile: 67 },
  { from: "2023-01-01", centsPerMile: 65.5 },
];

const EARLIEST = RATES[RATES.length - 1]!;

export type MileageRate = {
  centsPerMile: number;
  /** False when the date is outside the published table and a rate was carried. */
  exact: boolean;
};

/**
 * @param drovenOn ISO date, `YYYY-MM-DD`. Compared as a string, which is
 *   correct for ISO dates and avoids a timezone shifting a trip across a rate
 *   change — the one boundary where being off by a day changes the answer.
 */
export function mileageRate(drovenOn: string): MileageRate {
  const period = RATES.find((r) => drovenOn >= r.from);
  if (period) {
    // Later than every published period start means the newest rate is being
    // carried forward into a year the IRS has not set yet.
    const newest = RATES[0]!;
    const exact = period !== newest || drovenOn < nextYearOf(newest.from);
    return { centsPerMile: period.centsPerMile, exact };
  }
  return { centsPerMile: EARLIEST.centsPerMile, exact: false };
}

function nextYearOf(from: string): string {
  return `${Number(from.slice(0, 4)) + 1}-01-01`;
}

/**
 * The column's own ceiling. `miles_tenths` is an `int4`, so a value past its
 * range does not become a big number — it becomes a Postgres error raised out
 * of a form submission, which is user input reaching the database and failing
 * there. 214 million miles is not a trip anyone drove.
 */
export const MAX_MILES_TENTHS = 2_147_483_647;

/**
 * Miles are stored as tenths, because a log records 12.4 miles and a float
 * would put a fraction of a cent into a deduction. Same reason money is cents.
 */

export function tenthsFromMiles(input: string | number): number | null {
  const n = typeof input === "number" ? input : Number(String(input).trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  const tenths = Math.round(n * 10);
  if (tenths <= 0 || tenths > MAX_MILES_TENTHS) return null;
  return tenths;
}

export function milesFromTenths(tenths: number): number {
  return tenths / 10;
}

/** Deduction for one trip, in whole cents. */
export function tripDeductionCents(milesTenths: number, drovenOn: string): number {
  const { centsPerMile } = mileageRate(drovenOn);
  return Math.round((milesTenths / 10) * centsPerMile);
}

export type MileageTotal = {
  milesTenths: number;
  deductionCents: number;
  /** True when every trip fell inside a published rate period. */
  exact: boolean;
};

/**
 * Totals a set of trips.
 *
 * Summed per trip rather than by applying one rate to a total, because two
 * trips either side of a mid-year change are deducted at different rates and
 * a single multiplication cannot express that.
 */
export function totalDeduction(
  trips: Array<{ milesTenths: number; droveOn: string }>,
): MileageTotal {
  let milesTenths = 0;
  let deductionCents = 0;
  let exact = true;

  for (const trip of trips) {
    milesTenths += trip.milesTenths;
    deductionCents += tripDeductionCents(trip.milesTenths, trip.droveOn);
    if (!mileageRate(trip.droveOn).exact) exact = false;
  }

  return { milesTenths, deductionCents, exact };
}
