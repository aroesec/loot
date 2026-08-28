"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq, and, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  transactions,
  categories,
  budgets,
  recurringSeries,
  accounts,
  people,
} from "@/db/schema";
import {
  createSession,
  destroySession,
  attemptPasswordLogin,
  isAuthenticated,
} from "@/lib/auth";
import { headers } from "next/headers";
import { env } from "@/lib/env";
import { clientAddress, trustedHops } from "@/lib/http/client-address";
import {
  learnFromCorrection,
  invalidateRuleCache,
  reapplyAllRules,
} from "@/lib/classify/rules";
import { applyCorrection } from "@/lib/classify/correct";
import { classifyTransactions, classifyPending } from "@/lib/classify";
import { refreshRecurringSeries } from "@/lib/recurring";
import { unmergeTransaction, markCleared } from "@/lib/reconcile";
import { createMcpToken, revokeMcpToken } from "@/lib/mcp/tokens";
import { generateInsights, setInsightStatus } from "@/lib/insights";
import { saveTheme, THEME_DEFAULTS, type ThemeTokens } from "@/lib/theme";
import { currentMonth } from "@/lib/ledger";
import { setLedgerMode, setHousehold, setBusinessLogo } from "@/lib/mode";
import { validateLogo } from "@/lib/logo";
import { validatePerson } from "@/lib/people-validate";

async function requireSession() {
  if (!(await isAuthenticated())) redirect("/login");
}

// --- Auth -------------------------------------------------------------------

export async function loginAction(_prev: unknown, formData: FormData) {
  const password = String(formData.get("password") ?? "");

  /*
   * Throttled per client address, counted from the trusted end of the
   * forwarding chain — see `clientAddress`.
   *
   * Reading the *leftmost* `x-forwarded-for` entry, which is what this did,
   * took a value the caller writes: an attacker could pick a fresh one per
   * request to sidestep the lockout entirely, or send the owner's address to
   * drive the owner's bucket into lockout from anywhere.
   *
   * An address that cannot be established shares one key. That bounds the
   * overall guess rate, at the cost of one stranger being able to lock the
   * shared bucket — which is why establishing the address is worth
   * configuring `TRUST_PROXY_HOPS` for.
   */
  const h = await headers();
  const clientKey =
    clientAddress(h, trustedHops(env.TRUST_PROXY_HOPS, Boolean(process.env.VERCEL))) ??
    "unidentified";

  const result = await attemptPasswordLogin(password, clientKey);

  if (!result.ok) {
    if (result.retryAfter > 0) {
      const minutes = Math.ceil(result.retryAfter / 60);
      return {
        error: `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      };
    }
    // Deliberately identical whether the password was wrong or no password
    // method is configured at all.
    return { error: "That password does not match." };
  }

  redirect("/");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

// --- Transactions -----------------------------------------------------------

/**
 * Recategorizing by hand does two things: it fixes this transaction, and it
 * writes a rule so the same merchant is right next time. That second part is
 * the whole learning loop.
 */
export async function recategorizeAction(formData: FormData) {
  await requireSession();

  const id = String(formData.get("transactionId") ?? "");
  const categoryId = String(formData.get("categoryId") ?? "");
  if (!id || !categoryId) return;

  await applyCorrection({
    transactionId: id,
    categoryId,
    learn: formData.get("learn") === "on",
  });

  revalidatePath("/transactions");
  revalidatePath("/");
}

/**
 * The review queue's answer, one keystroke.
 *
 * Takes arguments rather than a FormData because the queue never navigates —
 * it advances to the next item and keeps the keyboard where it is. The result
 * comes back so the UI can say what happened without re-fetching.
 */
export async function triageAction(input: {
  transactionId: string;
  categoryId: string;
  learn: boolean;
}): Promise<{ ok: boolean; categoryName?: string; learned?: boolean }> {
  await requireSession();

  const result = await applyCorrection(input);
  if (!result.ok) return { ok: false };

  /*
   * Every total on these pages moves when a category does, and the queue is
   * the one place someone changes a lot of them in a row.
   */
  revalidatePath("/transactions");
  revalidatePath("/review/queue");
  revalidatePath("/");

  return { ok: true, categoryName: result.categoryName, learned: result.learned };
}

export async function reclassifyPendingAction() {
  await requireSession();
  await classifyPending();
  revalidatePath("/transactions");
  revalidatePath("/");
}

/**
 * Re-runs every rule over the whole ledger. Needed after adding or correcting a
 * rule, since rules otherwise only run at import time — a fix to a merchant
 * rule would not reach transactions imported before it existed.
 */
export async function reapplyRulesAction() {
  await requireSession();
  await reapplyAllRules();
  revalidatePath("/transactions");
  revalidatePath("/");
}

export async function reclassifyOneAction(formData: FormData) {
  await requireSession();
  const id = String(formData.get("transactionId") ?? "");
  if (!id) return;
  await classifyTransactions([id]);
  revalidatePath("/transactions");
}

export async function deleteTransactionAction(formData: FormData) {
  await requireSession();
  const id = String(formData.get("transactionId") ?? "");
  if (!id) return;
  await db.delete(transactions).where(eq(transactions.id, id));
  revalidatePath("/transactions");
  revalidatePath("/");
}

// --- Reconciliation ---------------------------------------------------------

/** Split a merged transaction back apart when the match was wrong. */
export async function unmergeAction(formData: FormData) {
  await requireSession();
  const id = String(formData.get("transactionId") ?? "");
  if (!id) return;
  await unmergeTransaction(id);
  revalidatePath("/review");
  revalidatePath("/transactions");
  revalidatePath("/");
}

/** Accept a pending entry as settled without waiting for a statement. */
export async function clearPendingAction(formData: FormData) {
  await requireSession();
  const id = String(formData.get("transactionId") ?? "");
  if (!id) return;
  await markCleared([id]);
  revalidatePath("/review");
}

// --- MCP tokens -------------------------------------------------------------

export async function issueMcpTokenAction(formData: FormData) {
  await requireSession();
  const name = String(formData.get("name") ?? "").trim() || "Claude";
  const issued = await createMcpToken(name);
  // Shown once. Passed back through the URL because it is never stored in
  // readable form and there is nowhere else to retrieve it from.
  redirect(`/settings?token=${encodeURIComponent(issued.token)}`);
}

export async function revokeMcpTokenAction(formData: FormData) {
  await requireSession();
  const id = String(formData.get("tokenId") ?? "");
  if (!id) return;
  await revokeMcpToken(id);
  revalidatePath("/settings");
}

// --- Budgets ----------------------------------------------------------------

export async function setBudgetAction(formData: FormData) {
  await requireSession();

  const categoryId = String(formData.get("categoryId") ?? "");
  const dollars = Number(formData.get("amount") ?? 0);
  if (!categoryId || !Number.isFinite(dollars)) return;

  const amountCents = Math.round(Math.abs(dollars) * 100);
  const effectiveFrom = `${currentMonth()}-01`;

  // Setting a budget to zero means "no budget" — close the current one out
  // rather than leaving a 0 target that reads as 100% over on any spend.
  if (amountCents === 0) {
    await db
      .delete(budgets)
      .where(
        and(
          eq(budgets.categoryId, categoryId),
          eq(budgets.effectiveFrom, effectiveFrom),
        ),
      );
    await db
      .update(budgets)
      .set({ effectiveTo: effectiveFrom })
      .where(
        and(eq(budgets.categoryId, categoryId), sql`${budgets.effectiveTo} IS NULL`),
      );
    revalidatePath("/budgets");
    return;
  }

  const existing = await db
    .select({ id: budgets.id })
    .from(budgets)
    .where(
      and(
        eq(budgets.categoryId, categoryId),
        eq(budgets.effectiveFrom, effectiveFrom),
      ),
    )
    .limit(1);

  if (existing[0]) {
    await db
      .update(budgets)
      .set({ amountCents })
      .where(eq(budgets.id, existing[0].id));
  } else {
    // Close any open-ended prior budget so history stays accurate.
    await db
      .update(budgets)
      .set({ effectiveTo: effectiveFrom })
      .where(
        and(eq(budgets.categoryId, categoryId), sql`${budgets.effectiveTo} IS NULL`),
      );
    await db.insert(budgets).values({ categoryId, amountCents, effectiveFrom });
  }

  revalidatePath("/budgets");
}

// --- Recurring --------------------------------------------------------------

export async function refreshRecurringAction() {
  await requireSession();
  await refreshRecurringSeries();
  revalidatePath("/recurring");
}

export async function setSeriesStatusAction(formData: FormData) {
  await requireSession();
  const id = String(formData.get("seriesId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !["active", "ended", "paused"].includes(status)) return;
  await db
    .update(recurringSeries)
    .set({ status: status as "active" | "ended" | "paused" })
    .where(eq(recurringSeries.id, id));
  revalidatePath("/recurring");
}

// --- Insights ---------------------------------------------------------------

export async function generateInsightsAction(formData: FormData) {
  await requireSession();
  const month = String(formData.get("month") ?? currentMonth());
  await generateInsights(month);
  revalidatePath("/insights");
}

export async function insightStatusAction(formData: FormData) {
  await requireSession();
  const id = String(formData.get("insightId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id) return;
  if (!["new", "read", "dismissed", "actioned"].includes(status)) return;
  await setInsightStatus(id, status as "new" | "read" | "dismissed" | "actioned");
  revalidatePath("/insights");
}

// --- Settings ---------------------------------------------------------------

export async function saveThemeAction(formData: FormData) {
  await requireSession();
  const tokens: ThemeTokens = {};
  for (const key of Object.keys(THEME_DEFAULTS)) {
    const value = formData.get(`token.${key}`);
    if (typeof value === "string" && value.trim()) tokens[key] = value.trim();
  }
  await saveTheme(tokens);
  revalidatePath("/", "layout");
}

export async function applyPresetAction(formData: FormData) {
  await requireSession();
  const { THEME_PRESETS } = await import("@/lib/theme");
  const id = String(formData.get("presetId") ?? "");
  const preset = THEME_PRESETS.find((p) => p.id === id);
  if (!preset) return;
  await saveTheme({ ...THEME_DEFAULTS, ...preset.tokens });
  revalidatePath("/", "layout");
}

export async function createAccountAction(formData: FormData) {
  await requireSession();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await db.insert(accounts).values({
    name,
    kind: (String(formData.get("kind") ?? "checking") as
      | "checking"
      | "savings"
      | "credit_card"
      | "investment"
      | "loan"
      | "cash"),
    institution: String(formData.get("institution") ?? "").trim() || null,
    last4: String(formData.get("last4") ?? "").trim() || null,
  });
  revalidatePath("/settings");
  revalidatePath("/upload");
}

/**
 * Update the business logo. Stored as base64, exactly as uploaded — this
 * app does no runtime image processing (see `src/db/icons.ts`'s comment on
 * why `sharp` stays a build-time-only tool). Silently no-ops on a missing
 * file or a failed validation, matching this file's existing precedent of
 * not wiring up error-display plumbing for settings forms.
 */
export async function updateBusinessLogoAction(formData: FormData) {
  await requireSession();
  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) return;

  const check = validateLogo(file.type, file.size);
  if (!check.ok) return;

  const data = Buffer.from(await file.arrayBuffer()).toString("base64");
  await setBusinessLogo(data, file.type);
  revalidatePath("/settings");
}

export async function removeBusinessLogoAction() {
  await requireSession();
  await setBusinessLogo(null, null);
  revalidatePath("/settings");
}

/**
 * Add a person to the business owner's roster.
 *
 * A contact list, not an account: no login, no payroll, no link to any
 * transaction. It exists only so a business-mode household has somewhere to
 * keep track of who it pays.
 */
export async function createPersonAction(formData: FormData) {
  await requireSession();
  const check = validatePerson({
    name: String(formData.get("name") ?? ""),
    type: String(formData.get("type") ?? ""),
    email: String(formData.get("email") ?? ""),
    note: String(formData.get("note") ?? ""),
  });
  if (!check.ok) return;

  await db.insert(people).values({
    name: check.name,
    type: check.type,
    email: check.email,
    note: check.note,
  });
  revalidatePath("/settings");
}

export async function archivePersonAction(formData: FormData) {
  await requireSession();
  const id = String(formData.get("personId") ?? "");
  if (!id) return;
  await db.update(people).set({ archivedAt: new Date() }).where(eq(people.id, id));
  revalidatePath("/settings");
}

/**
 * Switch the chart of accounts.
 *
 * Non-destructive: both taxonomies live in the table, so this re-points the
 * classifier and the reports rather than discarding anything. Existing
 * transactions keep whatever category they were given — switching does not
 * reclassify, because a year of answered questions should not be thrown away
 * by a toggle. Run `db:reclassify` afterwards if you want history re-filed
 * against the new chart.
 */
export async function setLedgerModeAction(formData: FormData) {
  await requireSession();
  const mode = String(formData.get("mode") ?? "personal");
  if (mode !== "personal" && mode !== "business") return;

  const name = String(formData.get("businessName") ?? "").trim();
  await setLedgerMode(mode, name || null);
  invalidateRuleCache();

  revalidatePath("/", "layout");
}

export async function setHouseholdAction(formData: FormData) {
  await requireSession();
  const adults = Math.max(1, Math.min(12, Number(formData.get("adults") ?? 1)));
  const children = Math.max(0, Math.min(12, Number(formData.get("children") ?? 0)));
  const country = String(formData.get("country") ?? "US").toUpperCase().slice(0, 2);
  const rawRegion = String(formData.get("region") ?? "").toUpperCase().slice(0, 2);
  await setHousehold({ adults, children, country, region: rawRegion || null });
  revalidatePath("/goals");
  revalidatePath("/settings");
}

/**
 * Finish the first run.
 *
 * Writes the mode first, because it decides which chart of accounts everything
 * afterwards is filed against, then the answers that only apply to that mode.
 * `markOnboarded` records that the questions were asked; it is not conditional
 * on the answers, so leaving the optional fields blank still counts as set up
 * and does not re-open the flow on the next page load.
 */
/**
 * Split one transaction into parts that sum to it.
 *
 * The parts arrive as parallel `amount`/`categoryId` fields. Amounts are typed
 * in dollars and converted here, once, at the boundary — a float must never
 * reach the ledger, and rounding after summing would let two halves of a
 * penny disappear.
 */
export async function splitTransactionAction(formData: FormData) {
  await requireSession();

  const id = String(formData.get("transactionId") ?? "");
  const amounts = formData.getAll("amount").map(String);
  const categoryIds = formData.getAll("categoryId").map(String);

  const parts = amounts
    .map((raw, i) => ({
      amountCents: Math.round(Number(raw) * 100),
      categoryId: categoryIds[i] ?? "",
    }))
    .filter((p) => p.categoryId && Number.isFinite(p.amountCents));

  const { splitTransaction } = await import("@/lib/split");
  const result = await splitTransaction(id, parts);

  revalidatePath("/transactions");
  revalidatePath("/");
  return result.ok ? undefined : result.message;
}

export async function unsplitTransactionAction(formData: FormData) {
  await requireSession();
  const { unsplitTransaction } = await import("@/lib/split");
  await unsplitTransaction(String(formData.get("groupId") ?? ""));
  revalidatePath("/transactions");
  revalidatePath("/");
}

export async function restartOnboardingAction() {
  await requireSession();
  const { resetOnboarding } = await import("@/lib/onboarding");
  await resetOnboarding();
  redirect("/welcome");
}

export async function completeOnboardingAction(formData: FormData) {
  await requireSession();

  const { setLedgerMode, setHousehold, setEstimatedTaxRate, setBusinessLogo, household } =
    await import("@/lib/mode");
  const { markOnboarded } = await import("@/lib/onboarding");

  const mode = formData.get("mode") === "business" ? "business" : "personal";

  if (mode === "business") {
    const name = String(formData.get("businessName") ?? "").trim();
    await setLedgerMode("business", name || null);

    const rate = Number(formData.get("rate"));
    if (Number.isFinite(rate)) await setEstimatedTaxRate(rate);

    // Optional, and never blocks the redirect below — this step's own copy
    // says everything here can be left blank and set later in Settings.
    const logo = formData.get("logo");
    if (logo instanceof File && logo.size > 0) {
      const check = validateLogo(logo.type, logo.size);
      if (check.ok) {
        const data = Buffer.from(await logo.arrayBuffer()).toString("base64");
        await setBusinessLogo(data, logo.type);
      }
    }
  } else {
    await setLedgerMode("personal", null);

    const current = await household();
    const adults = Number(formData.get("adults"));
    const children = Number(formData.get("children"));
    const region = String(formData.get("region") ?? "").toUpperCase().slice(0, 2);

    await setHousehold({
      adults: Number.isFinite(adults) ? Math.max(1, Math.min(12, adults)) : current.adults,
      children: Number.isFinite(children) ? Math.max(0, Math.min(12, children)) : current.children,
      country: region ? "US" : current.country,
      region: region || null,
    });
  }

  await markOnboarded();

  // The mode changes the navigation and the vocabulary on every page.
  revalidatePath("/", "layout");
  // Straight to importing, because an empty ledger answers nothing.
  redirect("/upload");
}

export async function setEstimatedTaxRateAction(formData: FormData) {
  await requireSession();
  const { setEstimatedTaxRate } = await import("@/lib/mode");
  await setEstimatedTaxRate(Number(formData.get("rate") ?? 22));
  revalidatePath("/schedule-c");
  revalidatePath("/settings");
}

export async function createCategoryAction(formData: FormData) {
  await requireSession();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!slug) return;

  await db
    .insert(categories)
    .values({
      slug,
      name,
      kind: (String(formData.get("kind") ?? "expense") as
        | "expense"
        | "income"
        | "transfer"),
      hint: String(formData.get("hint") ?? "").trim() || null,
      parentId: String(formData.get("parentId") ?? "") || null,
    })
    .onConflictDoNothing({ target: categories.slug });

  invalidateRuleCache();
  revalidatePath("/settings");
  revalidatePath("/transactions");
}
