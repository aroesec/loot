/**
 * The arithmetic behind a tax set-aside.
 *
 * DB-free so it can be tested without a database, like `dates.ts` and
 * `classify/match.ts`.
 *
 * The important line this module draws is between two very different numbers.
 * **Self-employment tax is computable** from net profit alone: the rates and
 * the wage base are published, and the result is exact. **Income tax is not.**
 * It depends on filing status, a spouse's income, other deductions, credits,
 * state, and the rest of the return, none of which this app knows.
 *
 * So the first is calculated and the second is a rate the person supplies. The
 * UI has to keep saying which is which, because presenting a guessed income tax
 * next to an exact SE tax makes both look equally authoritative.
 *
 * None of this is tax advice. It is a way to work out roughly how much of the
 * money currently in the account is already spoken for.
 */

/** 12.4% Social Security + 2.9% Medicare, on 92.35% of net profit. */
const SE_TAXABLE_SHARE = 0.9235;
const SOCIAL_SECURITY_RATE = 0.124;
const MEDICARE_RATE = 0.029;

/**
 * The Social Security wage base, which the SSA sets each year.
 *
 * Hardcoded per year because there is no way to derive it, and a wrong value
 * silently overstates or understates the bill for any profitable business. A
 * year that is not listed falls back to the most recent known figure and says
 * so, rather than pretending to a precision it does not have.
 */
const WAGE_BASE_CENTS: Record<number, number> = {
  2023: 16020000,
  2024: 16860000,
  2025: 17610000,
};

export function wageBase(year: number): { cents: number; exact: boolean } {
  const known = WAGE_BASE_CENTS[year];
  if (known) return { cents: known, exact: true };

  const latest = Math.max(...Object.keys(WAGE_BASE_CENTS).map(Number));
  return { cents: WAGE_BASE_CENTS[latest]!, exact: false };
}

export type SelfEmploymentTax = {
  /** Net profit multiplied by 92.35%. */
  taxableCents: number;
  socialSecurityCents: number;
  medicareCents: number;
  totalCents: number;
  /** Half of it is deductible against income tax. */
  deductibleHalfCents: number;
  /** False when the wage base for this year is not yet known. */
  wageBaseExact: boolean;
};

export function selfEmploymentTax(
  netProfitCents: number,
  year: number,
): SelfEmploymentTax {
  // A loss owes no self-employment tax, and carrying one forward is a decision
  // this app has no business making.
  if (netProfitCents <= 0) {
    return {
      taxableCents: 0,
      socialSecurityCents: 0,
      medicareCents: 0,
      totalCents: 0,
      deductibleHalfCents: 0,
      wageBaseExact: wageBase(year).exact,
    };
  }

  const taxable = Math.round(netProfitCents * SE_TAXABLE_SHARE);
  const base = wageBase(year);

  /*
   * Social Security stops at the wage base; Medicare does not. Ignoring the cap
   * overstates the bill by thousands for anyone above it, which is exactly the
   * person most likely to be relying on this figure.
   */
  const socialSecurity = Math.round(
    Math.min(taxable, base.cents) * SOCIAL_SECURITY_RATE,
  );
  const medicare = Math.round(taxable * MEDICARE_RATE);
  const total = socialSecurity + medicare;

  return {
    taxableCents: taxable,
    socialSecurityCents: socialSecurity,
    medicareCents: medicare,
    totalCents: total,
    deductibleHalfCents: Math.round(total / 2),
    wageBaseExact: base.exact,
  };
}

export type SetAside = {
  netProfitCents: number;
  selfEmployment: SelfEmploymentTax;
  /** The rate the person supplied, as a percentage. */
  incomeTaxRate: number;
  incomeTaxCents: number;
  totalCents: number;
  /** Total as a share of net profit, for a sanity check against reality. */
  effectiveRate: number | null;
};

/**
 * @param incomeTaxRate Percentage the person expects to pay on business
 *   profit. Applied to profit *after* deducting half the self-employment tax,
 *   which is how the actual return works.
 */
export function setAside(
  netProfitCents: number,
  year: number,
  incomeTaxRate: number,
): SetAside {
  const se = selfEmploymentTax(netProfitCents, year);

  const incomeBase = Math.max(0, netProfitCents - se.deductibleHalfCents);
  const incomeTax = Math.round(incomeBase * (incomeTaxRate / 100));
  const total = se.totalCents + incomeTax;

  return {
    netProfitCents,
    selfEmployment: se,
    incomeTaxRate,
    incomeTaxCents: incomeTax,
    totalCents: total,
    effectiveRate: netProfitCents > 0 ? total / netProfitCents : null,
  };
}

/**
 * When each quarter's estimated payment is due.
 *
 * The dates do not line up with the quarters they cover: the second period is
 * two months long and the fourth is paid in January of the following year.
 * Deriving them from the quarter number would produce three wrong answers.
 *
 * A due date falling on a weekend moves to the next business day. That is not
 * modelled here, since the point is which quarter is next rather than the exact
 * filing deadline.
 */
export function quarterDueDates(year: number): Array<{
  quarter: 1 | 2 | 3 | 4;
  covers: string;
  due: string;
}> {
  return [
    { quarter: 1, covers: `Jan–Mar ${year}`, due: `${year}-04-15` },
    { quarter: 2, covers: `Apr–May ${year}`, due: `${year}-06-15` },
    { quarter: 3, covers: `Jun–Aug ${year}`, due: `${year}-09-15` },
    { quarter: 4, covers: `Sep–Dec ${year}`, due: `${year + 1}-01-15` },
  ];
}

/** The next payment due on or after `today`, or null once the year is settled. */
export function nextQuarterDue(
  year: number,
  today: string,
): { quarter: 1 | 2 | 3 | 4; covers: string; due: string } | null {
  return quarterDueDates(year).find((q) => q.due >= today) ?? null;
}
