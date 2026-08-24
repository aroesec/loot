import { db } from "./index";
import { categories, merchantRules, settings } from "./schema";
import { DEFAULT_CATEGORIES, SEED_RULES } from "@/lib/classify/taxonomy";
import {
  BUSINESS_CATEGORIES,
  BUSINESS_SEED_RULES,
} from "@/lib/classify/taxonomy-business";
import { SEED_PRIORITY } from "@/lib/classify/rules";
import { eq, inArray } from "drizzle-orm";

/**
 * Idempotent. Running it again adds anything new from the taxonomy without
 * disturbing categories or rules the user has since edited.
 */
export async function seed(): Promise<{
  categories: number;
  rules: number;
  staleRulesRemoved: number;
}> {
  /*
   * Both charts of accounts are seeded, whichever mode the deployment is in.
   * They coexist in one table keyed by `mode`, so switching modes re-points
   * the classifier instead of discarding history — a year of personal data
   * stays readable after someone turns the same deployment into a business
   * ledger, and back.
   */
  const allCategories = [...DEFAULT_CATEGORIES, ...BUSINESS_CATEGORIES];

  // Parents first so children can reference them.
  const ordered = [
    ...allCategories.filter((c) => !c.parent),
    ...allCategories.filter((c) => c.parent),
  ];

  const idBySlug = new Map<string, string>();
  let categoryCount = 0;

  for (const [index, cat] of ordered.entries()) {
    const parentId = cat.parent ? idBySlug.get(cat.parent) : null;

    const [row] = await db
      .insert(categories)
      .values({
        slug: cat.slug,
        name: cat.name,
        kind: cat.kind,
        parentId: parentId ?? null,
        hint: cat.hint ?? null,
        color: cat.color ?? null,
        sortOrder: index,
        isSystem: cat.isSystem ?? false,
        budgetable: cat.budgetable ?? true,
        mode: cat.mode ?? "personal",
        plSection: cat.plSection ?? null,
        deductiblePct: cat.deductiblePct ?? null,
        scheduleCLine: cat.scheduleCLine ?? null,
      })
      // Only refresh the classifier-facing hint; leave name/color alone in
      // case they've been customized.
      .onConflictDoUpdate({
        target: categories.slug,
        // Refresh the classifier-facing and tax-facing fields; leave name and
        // colour alone in case they have been customized.
        set: {
          hint: cat.hint ?? null,
          mode: cat.mode ?? "personal",
          plSection: cat.plSection ?? null,
          deductiblePct: cat.deductiblePct ?? null,
          scheduleCLine: cat.scheduleCLine ?? null,
        },
      })
      .returning({ id: categories.id });

    if (row) {
      idBySlug.set(cat.slug, row.id);
      categoryCount++;
    }
  }

  let ruleCount = 0;
  const seededKeys = new Set<string>();

  for (const rule of [...SEED_RULES, ...BUSINESS_SEED_RULES]) {
    let categoryId: string | null = null;
    if (rule.category !== null) {
      categoryId = idBySlug.get(rule.category) ?? null;
      if (!categoryId) {
        console.warn(
          `seed rule "${rule.pattern}" references unknown category "${rule.category}"`,
        );
        continue;
      }
    }

    const matchType = rule.matchType ?? "contains";
    const appliesTo = rule.appliesTo ?? "any";
    const mode = rule.mode ?? "personal";
    // Mode is part of the key: the same pattern legitimately exists in
    // both charts of accounts pointing at different categories.
    seededKeys.add(`${rule.pattern} ${matchType} ${appliesTo} ${mode}`);

    const [row] = await db
      .insert(merchantRules)
      .values({
        pattern: rule.pattern,
        matchType,
        categoryId,
        merchantName: rule.merchant ?? null,
        priority: rule.priority ?? SEED_PRIORITY,
        source: "seed",
        appliesTo,
        mode,
        isTransfer: rule.isTransfer ?? false,
        queueForReview: rule.queueForReview ?? false,
      })
      /*
       * Refresh seeds in place, but only ones still marked `seed`. A rule the
       * user has corrected is promoted to `learned`, and the WHERE clause is
       * what keeps this from overwriting that answer on the next deploy.
       *
       * Without this the taxonomy could never be corrected: the old version of
       * this seeder did nothing on conflict, so the Venmo and Zelle rules that
       * filed $6,000 of contract work as an internal transfer would have survived
       * every reseed.
       */
      .onConflictDoUpdate({
        target: [
          merchantRules.pattern,
          merchantRules.matchType,
          merchantRules.appliesTo,
          merchantRules.mode,
        ],
        set: {
          categoryId,
          merchantName: rule.merchant ?? null,
          priority: rule.priority ?? SEED_PRIORITY,
          isTransfer: rule.isTransfer ?? false,
          queueForReview: rule.queueForReview ?? false,
          enabled: true,
        },
        setWhere: eq(merchantRules.source, "seed"),
      })
      .returning({ id: merchantRules.id });

    if (row) ruleCount++;
  }

  /*
   * Drop seeds that are no longer in the taxonomy. Scoped to source = 'seed'
   * so learned and hand-written rules are never touched.
   */
  const existingSeeds = await db
    .select({
      id: merchantRules.id,
      pattern: merchantRules.pattern,
      matchType: merchantRules.matchType,
      appliesTo: merchantRules.appliesTo,
      mode: merchantRules.mode,
    })
    .from(merchantRules)
    .where(eq(merchantRules.source, "seed"));

  const stale = existingSeeds
    .filter(
      (r) =>
        !seededKeys.has(`${r.pattern} ${r.matchType} ${r.appliesTo} ${r.mode}`),
    )
    .map((r) => r.id);

  if (stale.length > 0) {
    await db.delete(merchantRules).where(inArray(merchantRules.id, stale));
  }


  await db
    .insert(settings)
    .values({ id: "singleton" })
    .onConflictDoNothing({ target: settings.id });

  return {
    categories: categoryCount,
    rules: ruleCount,
    staleRulesRemoved: stale.length,
  };
}

/** True when the taxonomy has never been seeded. */
export async function needsSeed(): Promise<boolean> {
  const rows = await db.select({ id: categories.id }).from(categories).limit(1);
  return rows.length === 0;
}

export async function ensureSeeded(): Promise<void> {
  if (await needsSeed()) await seed();
}

// Allow `pnpm db:seed`.
if (process.argv[1]?.endsWith("seed.ts")) {
  seed()
    .then((r) => {
      console.log(
        `seeded ${r.categories} categories, ${r.rules} rules` +
          (r.staleRulesRemoved > 0
            ? `, removed ${r.staleRulesRemoved} retired`
            : ""),
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error("seed failed", err);
      process.exit(1);
    });
}
