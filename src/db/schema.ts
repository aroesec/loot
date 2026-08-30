import {
  pgTable,
  pgEnum,
  text,
  integer,
  bigint,
  boolean,
  date,
  timestamp,
  jsonb,
  uuid,
  index,
  uniqueIndex,
  real,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

/**
 * Money is stored as integer cents everywhere. Sign convention, applied
 * consistently across parsing, ledger math and the UI:
 *
 *   negative = money leaving the account (spending)
 *   positive = money entering the account (income, refunds)
 *
 * This makes a period's net cashflow a plain SUM(amount_cents) with no
 * per-row branching, which is what most of the ledger queries rely on.
 */

export const accountKind = pgEnum("account_kind", [
  "checking",
  "savings",
  "credit_card",
  "investment",
  "loan",
  "cash",
]);

export const categoryKind = pgEnum("category_kind", [
  "expense",
  "income",
  "transfer",
]);

/**
 * Which chart of accounts the deployment uses.
 *
 * Not cosmetic. A business ledger answers a different question — what is the
 * profit, and what is deductible — so the categories, the totals and the
 * classifier's framing all change with it.
 */
export const ledgerMode = pgEnum("ledger_mode", ["personal", "business"]);

/**
 * Where a business category sits in a profit-and-loss statement.
 *
 * `revenue - cogs = gross profit`, `gross profit - opex = net profit`. The
 * distinction between COGS and operating expense is what makes gross margin
 * meaningful, and it is not recoverable from the category name alone.
 *
 * `owner_equity` is the one that matters most, and it is the business analogue
 * of `is_transfer`: an owner's draw moves money out of the business without
 * being a business expense. Counting it as one understates profit and
 * overstates deductions — on a tax return, that is not a cosmetic error.
 */
export const plSection = pgEnum("pl_section", [
  "revenue",
  "cogs",
  "opex",
  "owner_equity",
  "other",
]);

export const statementStatus = pgEnum("statement_status", [
  "pending",
  "parsing",
  "parsed",
  "failed",
]);

export const sourceKind = pgEnum("source_kind", ["csv", "pdf", "image"]);

export const classificationSource = pgEnum("classification_source", [
  "rule",
  "llm",
  "manual",
  "unclassified",
]);

/** How a transaction entered the ledger. */
export const entrySource = pgEnum("entry_source", [
  /** Parsed from an uploaded statement — authoritative. */
  "statement",
  /** Logged conversationally (MCP) or by hand — provisional until it clears. */
  "manual",
]);

/**
 * A manually-logged purchase is `pending` until the same charge shows up on a
 * statement, at which point it becomes `cleared`. This is what keeps "I just
 * bought this" from double-counting against the statement that follows.
 */
export const transactionStatus = pgEnum("transaction_status", [
  "pending",
  "cleared",
]);

export const matchType = pgEnum("match_type", [
  "exact",
  "contains",
  "prefix",
  "regex",
]);

export const ruleSource = pgEnum("rule_source", ["seed", "learned", "manual"]);

/**
 * Which direction of money a rule applies to. The same description means two
 * different things depending on sign — "FID BKG SVC LLC MONEYLINE" is a
 * contribution on the way out and a withdrawal on the way back — so a rule can
 * scope itself instead of forcing one category onto both.
 */
export const ruleDirection = pgEnum("rule_direction", [
  "any",
  "debit",
  "credit",
]);

export const plaidItemStatus = pgEnum("plaid_item_status", [
  "active",
  /** Plaid returned ITEM_LOGIN_REQUIRED — the user has to re-authenticate. */
  "needs_reauth",
  "disconnected",
]);

export const cadence = pgEnum("cadence", [
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
  "annual",
  "irregular",
]);

export const seriesStatus = pgEnum("series_status", [
  "active",
  "ended",
  "paused",
]);

export const insightStatus = pgEnum("insight_status", [
  "new",
  "read",
  "dismissed",
  "actioned",
]);

export const insightSeverity = pgEnum("insight_severity", [
  "info",
  "opportunity",
  "warning",
]);

/**
 * A contact on the business owner's roster — not an app user. There is no
 * login, no payroll processing, and no link to any transaction; this exists
 * only so a business-mode household can keep a list of who it pays.
 */
export const personType = pgEnum("person_type", ["employee", "contractor"]);

/**
 * Whether a budget carries its unspent balance into the next month.
 *
 * `none` is the default and is what every budget did before this existed, so
 * turning the feature on cannot move a number nobody asked to move. `under`
 * carries a surplus but forgives a deficit; `both` carries the deficit too,
 * which is envelope budgeting proper. See `lib/budget-rollover.ts`.
 */
export const budgetRollover = pgEnum("budget_rollover", ["none", "under", "both"]);

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  kind: accountKind("kind").notNull().default("checking"),
  institution: text("institution"),
  last4: text("last4"),
  currency: text("currency").notNull().default("USD"),
  /** Plaid's id for this account, when it was linked rather than typed in. */
  plaidAccountId: text("plaid_account_id"),
  plaidItemId: uuid("plaid_item_id"),

  /**
   * Last known balance, refreshed on sync. Nullable because a hand-made
   * account has none and an unlinked one goes stale.
   *
   * The ledger is otherwise built entirely from flows, which is why it could
   * say "you spent more than you earned" without being able to say whether
   * that mattered. A buffer is a stock, not a flow, and answering "do I have
   * one" needs this.
   *
   * On a credit card the balance is what is owed, so it is a liability and
   * counts against liquid cash rather than toward it.
   */
  balanceCents: bigint("balance_cents", { mode: "number" }),
  /** Balance minus holds, where the institution reports it. */
  availableCents: bigint("available_cents", { mode: "number" }),
  balanceUpdatedAt: timestamp("balance_updated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

/**
 * A balance, as it stood on a day.
 *
 * `accounts.balance_cents` is a single slot that every sync overwrites, so the
 * ledger has always known what an account holds *now* and never what it held
 * in March. Net worth is only interesting as a line, and a line needs history
 * that nothing was keeping.
 *
 * One row per account per day, upserted: syncing four times in a day should
 * leave the day with its latest figure, not four of them. Nothing backfills —
 * a deployment that starts recording today has no line until tomorrow, which
 * is honest and is why the page says so.
 */
export const accountBalances = pgTable(
  "account_balances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    capturedOn: date("captured_on").notNull(),
    balanceCents: bigint("balance_cents", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("account_balances_day_key").on(t.accountId, t.capturedOn)],
);

/**
 * The business owner's roster, for business mode. A contact list, not a
 * user table — no login, no payroll processing, and nothing here is
 * referenced by a transaction. See `personType` above.
 */
export const people = pgTable("people", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  type: personType("type").notNull(),
  email: text("email"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

/**
 * A business mileage log.
 *
 * The one Schedule C figure no import can produce: the deduction comes from
 * miles driven rather than money that moved, so it has to be recorded by hand.
 * The IRS wants a date, the distance, where you went and why, which is exactly
 * these columns.
 *
 * Miles are stored as tenths for the same reason money is stored as cents — a
 * log records 12.4 miles, and a float would put a fraction of a cent into a
 * number that goes on a tax return. The rate is deliberately *not* stored: it
 * is a function of the date driven (see `lib/mileage.ts`), and duplicating it
 * per row would let a typo diverge from the published schedule.
 */
export const mileageTrips = pgTable(
  "mileage_trips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    droveOn: date("drove_on").notNull(),
    milesTenths: integer("miles_tenths").notNull(),
    /** Required: the IRS asks for a business purpose, not just a distance. */
    purpose: text("purpose").notNull(),
    destination: text("destination"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("mileage_trips_drove_on_idx").on(t.droveOn)],
);

/**
 * A linked bank login. One Item covers every account behind a single set of
 * credentials, which is also how Plaid's free tier is counted — so the four
 * institutions here are four Items, not one per account.
 */
export const plaidItems = pgTable("plaid_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Plaid's item_id. Stable across re-auth, unlike the access token. */
  itemId: text("item_id").notNull().unique(),
  /**
   * AES-256-GCM ciphertext, never the raw token. This grants read access to
   * real bank accounts for as long as it lives, so it does not sit in the
   * database in a form a leaked dump could use.
   */
  accessTokenEncrypted: text("access_token_encrypted").notNull(),
  institutionId: text("institution_id"),
  institutionName: text("institution_name"),
  /**
   * Opaque cursor from transactions/sync. Advanced only after a page is
   * committed, so an interrupted sync replays rather than skips.
   */
  cursor: text("cursor"),
  status: plaidItemStatus("status").notNull().default("active"),
  /** Set when Plaid reports the login needs the user's attention again. */
  errorCode: text("error_code"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * A browser or device that has agreed to receive notifications.
 *
 * Web Push rather than a hosted push service: it is a browser standard, needs
 * no third party between this app and the device, and works identically on a
 * self-hosted deployment. The alternative would mean routing a household's
 * spending alerts through someone else's infrastructure.
 */
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** The push service endpoint. Unique per browser install. */
  endpoint: text("endpoint").notNull().unique(),
  /**
   * Keys the push service requires to encrypt the payload. Useless without the
   * VAPID private key, which never leaves the server.
   */
  p256dh: text("p256dh").notNull(),
  authKey: text("auth_key").notNull(),
  /** For telling devices apart in the UI. */
  userAgent: text("user_agent"),
  /**
   * Set when the push service reports the subscription gone (404/410). Kept
   * rather than deleted so a device that unsubscribes is not silently
   * re-added by a stale client.
   */
  expiredAt: timestamp("expired_at", { withTimezone: true }),
  lastNotifiedAt: timestamp("last_notified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * What has already been sent, so a daily job does not repeat itself.
 *
 * Keyed by a caller-supplied dedupe key rather than by content: "you are over
 * budget on groceries" should be sent once this month, not every morning for
 * three weeks. Notification fatigue is the failure mode that makes people turn
 * alerts off, at which point the feature is worse than absent.
 */
export const notificationsSent = pgTable(
  "notifications_sent",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dedupeKey: text("dedupe_key").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("notifications_dedupe_key").on(t.dedupeKey),
    index("notifications_sent_at_idx").on(t.sentAt),
  ],
);

export const goalKind = pgEnum("goal_kind", [
  /** Months of ordinary spending held in cash, for the unplanned. */
  "buffer",
  /**
   * Money set aside monthly for an expense that arrives in lumps — car
   * repairs, home maintenance, annual premiums. The thing whose absence turns
   * a $6,000 project into a forced liquidation.
   */
  "sinking_fund",
  /** A target amount by a date. */
  "savings_target",
  "debt_payoff",
]);

/**
 * A target the user is working toward.
 *
 * Deliberately separate from budgets. A budget is a ceiling on a month's
 * spending; a goal is a balance to reach, and the failure it addresses is the
 * opposite one — not overspending in a category, but having nothing set aside
 * when something irregular arrives.
 */
export const goals = pgTable("goals", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: goalKind("kind").notNull(),
  name: text("name").notNull(),

  /** The amount to reach. For a buffer this is derived from spending. */
  targetCents: bigint("target_cents", { mode: "number" }),
  /** For a buffer, expressed in months of ordinary spending instead. */
  targetMonths: real("target_months"),

  /** What the user intends to put aside each month. */
  monthlyContributionCents: bigint("monthly_contribution_cents", {
    mode: "number",
  }),

  /** Which category this fund is for, when it is a sinking fund. */
  categoryId: uuid("category_id").references(() => categories.id, {
    onDelete: "set null",
  }),

  /** Where the money is held, when the user has said. */
  accountId: uuid("account_id").references(() => accounts.id, {
    onDelete: "set null",
  }),

  targetDate: date("target_date"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Categories — the classification taxonomy. Fully user-editable.
// ---------------------------------------------------------------------------

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    kind: categoryKind("kind").notNull().default("expense"),
    parentId: uuid("parent_id"),
    /** Short description fed to the classifier so it knows what belongs here. */
    hint: text("hint"),
    color: text("color"),
    sortOrder: integer("sort_order").notNull().default(0),
    /** System categories can be renamed but not deleted. */
    isSystem: boolean("is_system").notNull().default(false),
    budgetable: boolean("budgetable").notNull().default(true),

    /**
     * Which chart of accounts this category belongs to. Both sets live in one
     * table so a deployment can be switched without losing history, and the
     * mode decides which are offered to the classifier and shown in the UI.
     */
    mode: ledgerMode("mode").notNull().default("personal"),

    /** Where this sits in a P&L. Null on personal categories. */
    plSection: plSection("pl_section"),

    /**
     * Share of the expense that is tax-deductible, 0–100.
     *
     * Not a boolean, because the interesting cases are not: business meals are
     * commonly 50%, a home office is a percentage of the property, and a phone
     * used for both is whatever share is business use. Null means "not
     * applicable" — revenue, or a personal category.
     *
     * This is guidance for organizing records, not tax advice, and the rates
     * change. It is the user's number to override.
     */
    deductiblePct: integer("deductible_pct"),

    /**
     * The IRS Schedule C line this maps to, for a US sole proprietor. Purely
     * informational — it makes the year-end export legible to an accountant
     * instead of a wall of merchant names.
     */
    scheduleCLine: text("schedule_c_line"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("categories_slug_key").on(t.slug),
    index("categories_mode_idx").on(t.mode),
  ],
);

// ---------------------------------------------------------------------------
// Statements — one uploaded file
// ---------------------------------------------------------------------------

export const statements = pgTable(
  "statements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id").references(() => accounts.id, {
      onDelete: "set null",
    }),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sourceKind: sourceKind("source_kind").notNull(),
    byteSize: integer("byte_size").notNull().default(0),
    /** sha256 of the file bytes — re-uploading the same file is a no-op. */
    contentHash: text("content_hash").notNull(),
    status: statementStatus("status").notNull().default("pending"),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    transactionCount: integer("transaction_count").notNull().default(0),
    duplicateCount: integer("duplicate_count").notNull().default(0),
    error: text("error"),
    /** Token + latency accounting for the parse call, when the LLM was used. */
    parseUsage: jsonb("parse_usage").$type<ParseUsage | null>(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    parsedAt: timestamp("parsed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("statements_content_hash_key").on(t.contentHash),
    index("statements_uploaded_at_idx").on(t.uploadedAt),
  ],
);

export type ParseUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  ms: number;
};

// ---------------------------------------------------------------------------
// Transactions — the ledger itself
// ---------------------------------------------------------------------------

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id").references(() => accounts.id, {
      onDelete: "set null",
    }),
    statementId: uuid("statement_id").references(() => statements.id, {
      onDelete: "set null",
    }),

    postedOn: date("posted_on").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    currency: text("currency").notNull().default("USD"),

    /** Verbatim description from the statement. Never overwritten. */
    rawDescription: text("raw_description").notNull(),
    /** Cleaned-up merchant name, used for rule matching and grouping. */
    merchant: text("merchant"),

    categoryId: uuid("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    classificationSource: classificationSource("classification_source")
      .notNull()
      .default("unclassified"),
    classificationConfidence: real("classification_confidence"),
    classificationReason: text("classification_reason"),
    /** Set when a rule produced the category, for auditing and rule stats. */
    matchedRuleId: uuid("matched_rule_id"),

    /**
     * Excluded from every income/spend total, because the same dollar is
     * already counted somewhere else in this ledger — the matching side of a
     * move between two of the person's own accounts.
     *
     * This is NOT a category and never a substitute for one: a flagged row
     * still carries a real `category_id`. Money leaving for someone else is
     * spending no matter which rail carried it, so Venmo, Zelle, Cash App,
     * ATM withdrawals and card payments are categorized, not flagged.
     */
    isTransfer: boolean("is_transfer").notNull().default(false),
    recurringSeriesId: uuid("recurring_series_id"),

    notes: text("notes"),

    // --- Provenance and reconciliation ------------------------------------
    entrySource: entrySource("entry_source").notNull().default("statement"),
    status: transactionStatus("status").notNull().default("cleared"),
    /** Set when a statement row absorbed a previously-logged manual entry. */
    reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
    /** Human-readable account of what was matched, shown in the review queue. */
    reconciliationNote: text("reconciliation_note"),
    /**
     * What the user originally said, when a statement later corrected it — a
     * $50 dinner that posted at $59.40 with the tip. Keeping it makes a wrong
     * merge visible and reversible instead of silently rewriting history.
     */
    loggedAmountCents: bigint("logged_amount_cents", { mode: "number" }),

    /*
     * Splits.
     *
     * A split replaces one transaction with several siblings that sum to it,
     * rather than a parent with children. 54 places in this codebase build
     * their own transactions query; a parent row every one of them had to
     * remember to exclude would double-count the moment one forgot, which is
     * how $6,000 of spending once vanished from a month. Siblings are correct
     * in every existing query without changing any of them.
     *
     * `split_group_id` is shared by the siblings so they can be shown together
     * and merged back. `split_original_cents` is what the row was before, kept
     * so the reversal does not have to trust a re-sum.
     */
    splitGroupId: uuid("split_group_id"),
    splitOriginalCents: bigint("split_original_cents", { mode: "number" }),

    /**
     * sha256(account, date, amount, normalized description). Uploading an
     * overlapping statement re-derives the same hash and is skipped, which is
     * what makes "upload at any time" safe.
     */
    dedupeHash: text("dedupe_hash").notNull(),

    /**
     * Plaid's id for this transaction. A real identity rather than a
     * fingerprint, so repeat syncs and the pending-to-posted transition are
     * exact instead of inferred — `dedupe_hash` cannot do that, because Plaid
     * rewrites the description and the amount when a charge settles.
     */
    plaidTransactionId: text("plaid_transaction_id"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("transactions_dedupe_hash_key").on(t.dedupeHash),
    uniqueIndex("transactions_plaid_id_key").on(t.plaidTransactionId),
    index("transactions_posted_on_idx").on(t.postedOn),
    index("transactions_category_idx").on(t.categoryId),
    index("transactions_merchant_idx").on(t.merchant),
    index("transactions_account_idx").on(t.accountId),
    // The reconciler scans pending manual entries by date on every import.
    index("transactions_pending_idx").on(t.status, t.postedOn),
  ],
);

// ---------------------------------------------------------------------------
// Merchant rules — deterministic classification layer.
// Every manual correction writes one of these, so the system learns.
// ---------------------------------------------------------------------------

export const merchantRules = pgTable(
  "merchant_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Lower-cased needle matched against the normalized description. */
    pattern: text("pattern").notNull(),
    matchType: matchType("match_type").notNull().default("contains"),
    /**
     * Null makes this a merchant-only rule: it labels the merchant and leaves
     * the category to the model. Payment rails (Venmo, Zelle, Cash App) need
     * that — the rail is not a category.
     */
    categoryId: uuid("category_id").references(() => categories.id, {
      onDelete: "cascade",
    }),
    /** Canonical display name to write onto matching transactions. */
    merchantName: text("merchant_name"),
    /** Higher wins. Learned rules outrank seeds so corrections stick. */
    priority: integer("priority").notNull().default(100),
    source: ruleSource("source").notNull().default("manual"),
    /** Restricts the rule to money out, money in, or neither. */
    appliesTo: ruleDirection("applies_to").notNull().default("any"),
    /**
     * Which chart of accounts this rule belongs to. Both sets coexist, and
     * only the active mode's rules are loaded — "internal transfer" means the
     * same thing in each but points at a different category, so without this
     * one would silently overwrite the other.
     */
    mode: ledgerMode("mode").notNull().default("personal"),
    /**
     * Send straight to the review queue instead of the model.
     *
     * For descriptions that structurally cannot say what the money was for — a
     * Zelle carries a name and a reference number, never a purpose. The model
     * reads those and answers Uncategorized, which is correct and costs a call
     * to reach. This says so up front and asks the person instead.
     */
    queueForReview: boolean("queue_for_review").notNull().default(false),
    isTransfer: boolean("is_transfer").notNull().default(false),
    enabled: boolean("enabled").notNull().default(true),
    hitCount: integer("hit_count").notNull().default(0),
    lastMatchedAt: timestamp("last_matched_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Direction is part of the identity: the same pattern legitimately exists
    // once for debits and once for credits.
    uniqueIndex("merchant_rules_pattern_key").on(
      t.pattern,
      t.matchType,
      t.appliesTo,
      t.mode,
    ),
    index("merchant_rules_priority_idx").on(t.priority),
  ],
);

// ---------------------------------------------------------------------------
// Recurring series — subscription / bill detection
// ---------------------------------------------------------------------------

export const recurringSeries = pgTable(
  "recurring_series",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchant: text("merchant").notNull(),
    categoryId: uuid("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    cadence: cadence("cadence").notNull().default("monthly"),
    /** Median of observed amounts — resistant to a single odd charge. */
    typicalAmountCents: bigint("typical_amount_cents", {
      mode: "number",
    }).notNull(),
    lastAmountCents: bigint("last_amount_cents", { mode: "number" }).notNull(),
    firstSeenOn: date("first_seen_on").notNull(),
    lastSeenOn: date("last_seen_on").notNull(),
    nextExpectedOn: date("next_expected_on"),
    occurrences: integer("occurrences").notNull().default(0),
    status: seriesStatus("status").notNull().default("active"),
    /** Positive = the charge went up since the series started. */
    priceChangePct: real("price_change_pct"),
    /** Annualized cost at the current amount — drives "cancel this" math. */
    annualizedCents: bigint("annualized_cents", { mode: "number" })
      .notNull()
      .default(0),
    detectedAt: timestamp("detected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("recurring_series_merchant_key").on(t.merchant)],
);

// ---------------------------------------------------------------------------
// Budgets — per-category monthly target, versioned by effective date
// ---------------------------------------------------------------------------

export const budgets = pgTable(
  "budgets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    /** Monthly target as a positive number of cents. */
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    rollover: budgetRollover("rollover").notNull().default("none"),
    effectiveFrom: date("effective_from").notNull(),
    /** NULL = still in force. */
    effectiveTo: date("effective_to"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("budgets_category_idx").on(t.categoryId, t.effectiveFrom)],
);

// ---------------------------------------------------------------------------
// Insights — the AI suggestion feed
// ---------------------------------------------------------------------------

export const insights = pgTable(
  "insights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    severity: insightSeverity("severity").notNull().default("info"),
    /** Estimated annual dollars at stake, so the feed can be ranked. */
    impactCents: bigint("impact_cents", { mode: "number" })
      .notNull()
      .default(0),
    categoryId: uuid("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    /** First day of the month the insight was computed for. */
    periodMonth: date("period_month").notNull(),
    status: insightStatus("status").notNull().default("new"),
    /** The figures the model was given, so a claim can always be traced. */
    evidence: jsonb("evidence").$type<Record<string, unknown>>(),
    /** Stops the same suggestion reappearing every run. */
    fingerprint: text("fingerprint").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("insights_fingerprint_key").on(t.fingerprint),
    index("insights_period_idx").on(t.periodMonth),
  ],
);

// ---------------------------------------------------------------------------
// Settings — single row (id = 'singleton'), holds the theme
// ---------------------------------------------------------------------------

export const settings = pgTable("settings", {
  id: text("id").primaryKey().default("singleton"),
  currency: text("currency").notNull().default("USD"),
  timezone: text("timezone").notNull().default("UTC"),
  /** Theme tokens, merged over the defaults at render time. */
  theme: jsonb("theme").$type<Record<string, string>>().notNull().default({}),
  /** Monthly take-home, used for savings-rate math when income is irregular. */
  monthlyIncomeCents: bigint("monthly_income_cents", { mode: "number" }),

  /**
   * Personal or business. Chosen at setup and switchable afterwards — the two
   * taxonomies coexist, so switching re-points the classifier rather than
   * discarding anything.
   */
  ledgerMode: ledgerMode("ledger_mode").notNull().default("personal"),

  /** Shown on business reports and the year-end export. */
  businessName: text("business_name"),

  /**
   * The business's logo, stored as it was uploaded (base64) rather than as
   * a file path — this app has no object storage, and a logo is small
   * enough that a text column is simpler than standing one up. Nullable:
   * most deployments never set one.
   */
  businessLogoData: text("business_logo_data"),
  businessLogoMimeType: text("business_logo_mime_type"),

  /**
   * Household size, used only to scale published benchmarks. A per-person
   * grocery figure means nothing without it, and defaulting to one person
   * silently tells a family of four that they overspend on everything.
   */
  householdAdults: integer("household_adults").notNull().default(1),
  householdChildren: integer("household_children").notNull().default(0),
  /** ISO country code; benchmark providers are country-scoped. */
  country: text("country").notNull().default("US"),
  /**
   * State or region code, where the country has one. Used to adjust national
   * averages, which is the largest single source of error in comparing a
   * household to a published mean — housing and food in a coastal metro bear
   * little relation to a national figure.
   */
  region: text("region"),

  /*
   * Percentage of business profit to set aside for income tax.
   *
   * Supplied rather than computed. Self-employment tax follows from profit
   * alone, but income tax depends on filing status, a spouse's income, other
   * deductions and the rest of the return, none of which this app knows.
   * Guessing it would put a made-up number next to an exact one.
   */
  estimatedTaxRate: integer("estimated_tax_rate").notNull().default(22),

  /*
   * When the first-run questions were answered.
   *
   * Records that the person was *asked*, not what they said. Inferring setup
   * from the presence of transactions would re-open the flow for anyone who
   * deleted their last row, and skip it for anyone who imported first.
   */
  onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// MCP access tokens
// ---------------------------------------------------------------------------

/**
 * Bearer tokens for the MCP server. Only the hash is stored, so a leaked
 * database never yields a working token, and lookup is by hash rather than by
 * comparing candidates — there is no secret-dependent comparison to time.
 */
export const mcpTokens = pgTable(
  "mcp_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    revoked: boolean("revoked").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("mcp_tokens_hash_key").on(t.tokenHash)],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const accountsRelations = relations(accounts, ({ many }) => ({
  transactions: many(transactions),
  statements: many(statements),
}));

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
    relationName: "category_parent",
  }),
  children: many(categories, { relationName: "category_parent" }),
  transactions: many(transactions),
  rules: many(merchantRules),
  budgets: many(budgets),
}));

export const statementsRelations = relations(statements, ({ one, many }) => ({
  account: one(accounts, {
    fields: [statements.accountId],
    references: [accounts.id],
  }),
  transactions: many(transactions),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  account: one(accounts, {
    fields: [transactions.accountId],
    references: [accounts.id],
  }),
  statement: one(statements, {
    fields: [transactions.statementId],
    references: [statements.id],
  }),
  category: one(categories, {
    fields: [transactions.categoryId],
    references: [categories.id],
  }),
  series: one(recurringSeries, {
    fields: [transactions.recurringSeriesId],
    references: [recurringSeries.id],
  }),
}));

export const merchantRulesRelations = relations(merchantRules, ({ one }) => ({
  category: one(categories, {
    fields: [merchantRules.categoryId],
    references: [categories.id],
  }),
}));

export const budgetsRelations = relations(budgets, ({ one }) => ({
  category: one(categories, {
    fields: [budgets.categoryId],
    references: [categories.id],
  }),
}));

export const recurringSeriesRelations = relations(
  recurringSeries,
  ({ one, many }) => ({
    category: one(categories, {
      fields: [recurringSeries.categoryId],
      references: [categories.id],
    }),
    transactions: many(transactions),
  }),
);

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type Statement = typeof statements.$inferSelect;
export type NewStatement = typeof statements.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type MerchantRule = typeof merchantRules.$inferSelect;
export type NewMerchantRule = typeof merchantRules.$inferInsert;
export type RecurringSeriesRow = typeof recurringSeries.$inferSelect;
export type Budget = typeof budgets.$inferSelect;
export type Insight = typeof insights.$inferSelect;
export type NewInsight = typeof insights.$inferInsert;
export type Settings = typeof settings.$inferSelect;
export type Person = typeof people.$inferSelect;
export type NewPerson = typeof people.$inferInsert;
export type MileageTrip = typeof mileageTrips.$inferSelect;
