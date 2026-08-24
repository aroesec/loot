/**
 * Comparing spending to something outside the ledger.
 *
 * The ledger can say what a category costs and whether it moved. It cannot say
 * whether it is *high*, and that is often the question — "is $2,300 a month on
 * groceries a lot?" has an answer, but not one that lives in your own data.
 *
 * Two rules shape this, and both exist because the alternative is confidently
 * wrong advice:
 *
 * **A benchmark is a reference point, never a target.** Household size, region,
 * dietary needs, whether a category absorbs spending that would otherwise sit
 * elsewhere — all of it moves the number. The UI says "compared with" and never
 * "you should".
 *
 * **Every figure carries its source and its vintage.** A number without a
 * citation is indistinguishable from one that was made up, and published
 * averages are revised annually. A stale figure presented as current is worse
 * than no figure at all, so the year travels with the value and is shown.
 *
 * The interface is a provider so a deployment can replace the shipped US
 * dataset entirely — a different country, a regional adjustment, or numbers a
 * household considers realistic for itself.
 */

export type Benchmark = {
  /** Category slug in this ledger's taxonomy. */
  categorySlug: string;
  /** Monthly figure, in cents, already scaled for household size. */
  monthlyCents: number;
  /** Where the number comes from. Shown to the user, never omitted. */
  source: string;
  /** Year the underlying data describes. */
  asOf: number;
  /** What the figure covers, when that is not obvious from the category. */
  note?: string;
};

export type HouseholdProfile = {
  /** Adults and children, used to scale per-person figures. */
  adults: number;
  children: number;
  /** ISO country code. Providers that only cover one country check this. */
  country: string;
  /** State or region code, where the country has one. May be null. */
  region?: string | null;
};

export const DEFAULT_HOUSEHOLD: HouseholdProfile = {
  adults: 1,
  children: 0,
  country: "US",
};

export type BenchmarkProvider = {
  id: string;
  label: string;
  /** False when the provider has nothing useful for this household. */
  covers(household: HouseholdProfile): boolean;
  benchmarks(household: HouseholdProfile): Benchmark[];
};

const providers: BenchmarkProvider[] = [];

export function registerBenchmarkProvider(provider: BenchmarkProvider): void {
  providers.push(provider);
}

export function listBenchmarkProviders(): readonly BenchmarkProvider[] {
  return providers;
}

/**
 * The benchmarks that apply, later providers overriding earlier ones per
 * category — so a deployment can register its own for a handful of categories
 * without restating the whole set.
 */
export function benchmarksFor(household: HouseholdProfile): Benchmark[] {
  const merged = new Map<string, Benchmark>();
  for (const provider of providers) {
    if (!provider.covers(household)) continue;
    for (const b of provider.benchmarks(household)) {
      merged.set(b.categorySlug, b);
    }
  }
  return [...merged.values()];
}

export type Comparison = {
  categorySlug: string;
  categoryName: string;
  /** The household's own median monthly spend. */
  actualCents: number;
  benchmark: Benchmark;
  /** Actual divided by benchmark. 1.0 is level with it. */
  ratio: number;
  /** Cents above the benchmark, or zero. */
  overCents: number;
};

/**
 * Compare actual spending to the benchmarks.
 *
 * Categories with no benchmark are omitted rather than assumed to be fine —
 * silence is the honest output when there is nothing to compare against.
 */
export function compare(
  actuals: Array<{ slug: string; name: string; monthlyCents: number }>,
  household: HouseholdProfile,
): Comparison[] {
  const byCategory = new Map(
    benchmarksFor(household).map((b) => [b.categorySlug, b]),
  );

  const out: Comparison[] = [];
  for (const a of actuals) {
    const benchmark = byCategory.get(a.slug);
    if (!benchmark || benchmark.monthlyCents <= 0) continue;
    out.push({
      categorySlug: a.slug,
      categoryName: a.name,
      actualCents: a.monthlyCents,
      benchmark,
      ratio: a.monthlyCents / benchmark.monthlyCents,
      overCents: Math.max(0, a.monthlyCents - benchmark.monthlyCents),
    });
  }

  return out.sort((x, y) => y.overCents - x.overCents);
}
