import { eq } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schema";

export type LedgerMode = "personal" | "business";

/**
 * Which chart of accounts this deployment uses.
 *
 * Read on every classification and every summary, and it changes rarely, so it
 * is cached for a short window rather than fetched each time. The window is
 * short enough that flipping the mode in Settings takes effect without a
 * restart.
 */
let cache: { mode: LedgerMode; at: number } | null = null;
const TTL_MS = 10_000;

export async function ledgerMode(): Promise<LedgerMode> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.mode;

  const [row] = await db
    .select({ mode: settings.ledgerMode, name: settings.businessName })
    .from(settings)
    .where(eq(settings.id, "singleton"))
    .limit(1);

  cache = { mode: (row?.mode as LedgerMode) ?? "personal", at: Date.now() };
  return cache.mode;
}

export async function setLedgerMode(
  mode: LedgerMode,
  businessName?: string | null,
): Promise<void> {
  await db
    .insert(settings)
    .values({
      id: "singleton",
      ledgerMode: mode,
      businessName: businessName ?? null,
    })
    .onConflictDoUpdate({
      target: settings.id,
      set: {
        ledgerMode: mode,
        ...(businessName !== undefined ? { businessName } : {}),
        updatedAt: new Date(),
      },
    });
  cache = null;
}

export async function businessName(): Promise<string | null> {
  const [row] = await db
    .select({ name: settings.businessName })
    .from(settings)
    .where(eq(settings.id, "singleton"))
    .limit(1);
  return row?.name ?? null;
}

export function invalidateModeCache(): void {
  cache = null;
}

/**
 * Vocabulary that differs between the two ledgers.
 *
 * A business does not have a savings rate and a person does not have a gross
 * margin. Swapping the words is not decoration — showing "Savings rate" on a
 * P&L invites someone to read a number that does not mean what it says.
 */
export const VOCABULARY = {
  personal: {
    income: "Income",
    spending: "Spending",
    net: "Net",
    ratio: "Savings rate",
    summaryNoun: "month",
  },
  business: {
    income: "Revenue",
    spending: "Expenses",
    net: "Net profit",
    ratio: "Net margin",
    summaryNoun: "period",
  },
} as const;

export function vocabulary(mode: LedgerMode) {
  return VOCABULARY[mode];
}


export type Household = {
  adults: number;
  children: number;
  country: string;
  region: string | null;
};

/**
 * Household size, used only to scale published benchmarks.
 *
 * Defaulting to one person silently tells a family of four that they overspend
 * on everything, so this is asked for rather than assumed — and the comparison
 * is hidden entirely until it is set.
 */
export async function household(): Promise<Household> {
  const [row] = await db
    .select({
      adults: settings.householdAdults,
      children: settings.householdChildren,
      country: settings.country,
      region: settings.region,
    })
    .from(settings)
    .where(eq(settings.id, "singleton"))
    .limit(1);

  return {
    adults: row?.adults ?? 1,
    children: row?.children ?? 0,
    country: row?.country ?? "US",
    region: row?.region ?? null,
  };
}

export async function setHousehold(input: Household): Promise<void> {
  await db
    .insert(settings)
    .values({
      id: "singleton",
      householdAdults: input.adults,
      householdChildren: input.children,
      country: input.country,
      region: input.region,
    })
    .onConflictDoUpdate({
      target: settings.id,
      set: {
        householdAdults: input.adults,
        householdChildren: input.children,
        country: input.country,
        region: input.region,
        updatedAt: new Date(),
      },
    });
}


/**
 * Percentage of business profit to hold back for income tax.
 *
 * Supplied by the person, not derived. See the column comment in the schema:
 * self-employment tax follows from profit, income tax does not.
 */
export async function estimatedTaxRate(): Promise<number> {
  const [row] = await db
    .select({ rate: settings.estimatedTaxRate })
    .from(settings)
    .where(eq(settings.id, "singleton"));
  return row?.rate ?? 22;
}

export async function setEstimatedTaxRate(rate: number): Promise<void> {
  const clamped = Math.max(0, Math.min(60, Math.round(rate)));
  await db
    .insert(settings)
    .values({ id: "singleton", estimatedTaxRate: clamped })
    .onConflictDoUpdate({
      target: settings.id,
      set: { estimatedTaxRate: clamped, updatedAt: new Date() },
    });
}

export type BusinessLogo = { data: string; mimeType: string };

export async function businessLogo(): Promise<BusinessLogo | null> {
  const [row] = await db
    .select({
      data: settings.businessLogoData,
      mimeType: settings.businessLogoMimeType,
    })
    .from(settings)
    .where(eq(settings.id, "singleton"))
    .limit(1);

  if (!row?.data || !row?.mimeType) return null;
  return { data: row.data, mimeType: row.mimeType };
}

export async function setBusinessLogo(
  data: string | null,
  mimeType: string | null,
): Promise<void> {
  await db
    .insert(settings)
    .values({
      id: "singleton",
      businessLogoData: data,
      businessLogoMimeType: mimeType,
    })
    .onConflictDoUpdate({
      target: settings.id,
      set: {
        businessLogoData: data,
        businessLogoMimeType: mimeType,
        updatedAt: new Date(),
      },
    });
}
