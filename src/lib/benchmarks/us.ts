import {
  registerBenchmarkProvider,
  type Benchmark,
  type HouseholdProfile,
} from "./types";
import { RPP_ASOF, knownRegion, regionalMultiplier } from "./regions";

/**
 * US reference figures, from published federal surveys.
 *
 * **These are approximate and they go stale.** Both sources are revised
 * annually, and the values below were transcribed at the vintage marked on
 * each. Before leaning on them, check them against the current releases:
 *
 *   USDA Food Plans, monthly cost of food at home, published monthly:
 *   https://www.fns.usda.gov/cnpp/usda-food-plans-cost-food-reports
 *
 *   BLS Consumer Expenditure Survey, average annual expenditures:
 *   https://www.bls.gov/cex/tables.htm
 *
 * They are shipped because a reference point that is roughly right beats no
 * reference point when the question is "is this a lot?" — and because the
 * alternative, a household guessing at its own norms, has no outside view at
 * all. They are not shipped as targets, and the UI never presents them as one.
 *
 * Two structural caveats worth stating in code rather than only in a footnote:
 *
 * **Averages are not medians.** BLS reports means, which a small number of very
 * high spenders pull upward. Sitting under the average is weaker evidence of
 * thrift than it appears.
 *
 * **Region moves these a great deal.** Housing and food in a coastal metro bear
 * little relation to a national mean. A deployment that cares should register
 * its own provider; that is why this is a provider and not a constant.
 */

/** BLS reports per household; USDA reports per person. Scaling differs. */
const USDA_MODERATE_MONTHLY_PER_ADULT_CENTS = 36_000;
const USDA_MODERATE_MONTHLY_PER_CHILD_CENTS = 27_000;

/**
 * Non-food categories scale sub-linearly with household size: a second adult
 * does not double the electricity bill. The square-root rule is the usual
 * equivalence adjustment and is closer than either extreme.
 */
function householdScale(household: HouseholdProfile): number {
  const people = Math.max(1, household.adults + household.children);
  return Math.sqrt(people / 2.5); // BLS average household is ~2.5 people
}

const BLS_ASOF = 2023;
const USDA_ASOF = 2024;

/** Average annual expenditure per household, in cents, at BLS_ASOF. */
const BLS_ANNUAL_CENTS: Record<string, number> = {
  restaurants: 393_000,
  groceries: 604_000,
  "gas-fuel": 246_000,
  "car-maintenance": 108_000,
  "car-insurance": 176_000,
  "electric-gas": 175_000,
  "water-trash": 51_000,
  internet: 71_000,
  "mobile-phone": 145_000,
  clothing: 194_000,
  entertainment: 348_000,
  "personal-care": 87_000,
  medical: 604_000,
  pharmacy: 116_000,
  fitness: 45_000,
  streaming: 47_000,
  lodging: 118_000,
  flights: 62_000,
  "home-maintenance": 340_000,
  "general-merchandise": 200_000,
  "gifts-donations": 220_000,
};

registerBenchmarkProvider({
  id: "us-federal",
  label: "US federal survey averages",
  covers: (household) => household.country === "US",

  benchmarks(household): Benchmark[] {
    const out: Benchmark[] = [];
    const scale = householdScale(household);

    /*
     * Regional adjustment is applied to every figure. It is the largest single
     * correction available: a national mean compared against a coastal metro is
     * wrong in a known direction, and leaving it uncorrected quietly tells
     * people in expensive places that they overspend on everything.
     */
    const regional = regionalMultiplier(household.region);
    const regionNote = knownRegion(household.region)
      ? ` Adjusted for ${household.region!.toUpperCase()} using BEA Regional Price Parities (${RPP_ASOF}); state-wide, so within-state variation is not captured.`
      : " Not adjusted for region — set a state to correct for local price levels.";

    /*
     * Groceries come from USDA rather than BLS. The Food Plans are built per
     * person by age and are the figure people actually recognize, whereas the
     * BLS food-at-home mean is a household average across very different
     * household sizes.
     */
    const groceries =
      household.adults * USDA_MODERATE_MONTHLY_PER_ADULT_CENTS +
      household.children * USDA_MODERATE_MONTHLY_PER_CHILD_CENTS;

    if (groceries > 0) {
      out.push({
        categorySlug: "groceries",
        monthlyCents: Math.round(groceries * regional),
        source: "USDA Food Plans, moderate-cost, food at home",
        asOf: USDA_ASOF,
        note: `${household.adults} adult${household.adults === 1 ? "" : "s"}${
          household.children ? ` and ${household.children} child${household.children === 1 ? "" : "ren"}` : ""
        }. The thrifty plan is roughly a third less, the liberal plan roughly a quarter more.${regionNote}`,
      });
    }

    for (const [slug, annual] of Object.entries(BLS_ANNUAL_CENTS)) {
      if (slug === "groceries") continue; // USDA figure above wins.
      out.push({
        categorySlug: slug,
        monthlyCents: Math.round((annual / 12) * scale * regional),
        source: "BLS Consumer Expenditure Survey, average annual expenditures",
        asOf: BLS_ASOF,
        note:
          `A mean rather than a median, so a minority of high spenders pulls it up. Scaled for household size.${regionNote}`,
      });
    }

    return out;
  },
});
