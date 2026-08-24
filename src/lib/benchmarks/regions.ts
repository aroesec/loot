/**
 * Regional price adjustment for the US.
 *
 * A national mean is the largest single source of error when comparing one
 * household to published figures: the same grocery basket differs by roughly a
 * quarter between the cheapest and dearest states, and housing by far more.
 * Applying a regional factor does not make the comparison exact, but it moves
 * it from "wrong in a known direction" to "roughly right".
 *
 * The figures are **BEA Regional Price Parities**, which express a state's
 * overall price level against a national 100. They are published annually and
 * revised; these were transcribed at the vintage below and should be checked
 * against the current release:
 *
 *   https://www.bea.gov/data/prices-inflation/regional-price-parities-state-and-metro-area
 *
 * Two honest limits. RPPs are **state-wide**, and within-state variation is
 * often larger than between-state — a rural county and its state's largest
 * metro can differ by more than the state differs from the national mean. And
 * the all-items parity is applied to every category here, whereas in reality
 * housing varies far more than food does. A deployment that needs better than
 * this should register its own provider.
 */

export const RPP_ASOF = 2023;

/** State's overall price level, national average = 100. */
export const STATE_PRICE_LEVEL: Record<string, number> = {
  AL: 87.9, AK: 105.5, AZ: 96.8, AR: 86.2, CA: 112.4,
  CO: 102.7, CT: 105.4, DE: 99.9, DC: 115.8, FL: 100.3,
  GA: 93.0, HI: 111.6, ID: 93.1, IL: 99.4, IN: 90.6,
  IA: 89.4, KS: 89.6, KY: 88.3, LA: 89.7, ME: 97.2,
  MD: 106.0, MA: 108.6, MI: 92.5, MN: 96.9, MS: 86.4,
  MO: 89.6, MT: 94.6, NE: 90.4, NV: 98.8, NH: 105.4,
  NJ: 111.0, NM: 92.0, NY: 108.9, NC: 92.4, ND: 90.0,
  OH: 90.6, OK: 87.7, OR: 100.0, PA: 97.6, RI: 100.6,
  SC: 91.6, SD: 88.6, TN: 90.7, TX: 96.1, UT: 97.5,
  VT: 100.5, VA: 102.0, WA: 106.4, WV: 86.6, WI: 92.5, WY: 92.1,
};

/**
 * The multiplier for a region, or 1 when it is unknown.
 *
 * Unknown returns the national figure unadjusted rather than refusing to
 * compare — the national mean is still a useful reference, just a blunter one,
 * and the UI says which was used.
 */
export function regionalMultiplier(region: string | null | undefined): number {
  if (!region) return 1;
  const level = STATE_PRICE_LEVEL[region.toUpperCase()];
  return level ? level / 100 : 1;
}

export function knownRegion(region: string | null | undefined): boolean {
  return Boolean(region && STATE_PRICE_LEVEL[region.toUpperCase()]);
}
