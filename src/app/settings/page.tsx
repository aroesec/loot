import { requireAuth } from "@/lib/auth";
import { db } from "@/db";
import { accounts, categories, merchantRules, plaidItems, people } from "@/db/schema";
import { listMcpTokens } from "@/lib/mcp/tokens";
import { desc, eq, sql, isNull } from "drizzle-orm";
import { loadTheme, EDITABLE_TOKENS, THEME_PRESETS } from "@/lib/theme";
import { hasLlm, hasPlaid, hasSms, env } from "@/lib/env";
import { PageHeader, Card } from "@/components/ui";
import { PlaidLinkButton } from "@/components/plaid-link";
import { PushToggle } from "@/components/push-toggle";
import { ledgerMode, businessName, household, businessLogo } from "@/lib/mode";
import { PERSON_TYPES } from "@/lib/people-validate";
import { LOGO_ALLOWED_MIME_TYPES, LOGO_MAX_BYTES } from "@/lib/logo";
import { ACCOUNT_KINDS } from "@/lib/account-kinds";
import {
  saveThemeAction,
  applyPresetAction,
  createAccountAction,
  updateAccountAction,
  setLedgerModeAction,
  setHouseholdAction,
  createCategoryAction,
  issueMcpTokenAction,
  revokeMcpTokenAction,
  logoutAction,
  updateBusinessLogoAction,
  removeBusinessLogoAction,
  createPersonAction,
  updatePersonAction,
  archivePersonAction,
} from "../actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  await requireAuth();
  const params = await searchParams;
  const [mode, bizName, home, logo] = await Promise.all([
    ledgerMode(),
    businessName(),
    household(),
    businessLogo(),
  ]);

  const [theme, accountRows, categoryRows, ruleStats, topRules, tokens, plaidRows, personRows] = await Promise.all([
    loadTheme(),
    db.select().from(accounts).where(isNull(accounts.archivedAt)).orderBy(accounts.name),
    db
      .select({ id: categories.id, name: categories.name, slug: categories.slug, kind: categories.kind, parentId: categories.parentId })
      .from(categories)
      .orderBy(categories.sortOrder),
    db
      .select({
        total: sql<string>`count(*)`,
        learned: sql<string>`count(*) filter (where ${merchantRules.source} = 'learned')`,
      })
      .from(merchantRules),
    db
      .select({
        pattern: merchantRules.pattern,
        hitCount: merchantRules.hitCount,
        source: merchantRules.source,
        categoryName: categories.name,
      })
      .from(merchantRules)
      .leftJoin(categories, eq(merchantRules.categoryId, categories.id))
      .orderBy(desc(merchantRules.hitCount))
      .limit(10),
    listMcpTokens(),
    db
      .select({
        id: plaidItems.id,
        institutionName: plaidItems.institutionName,
        status: plaidItems.status,
        errorCode: plaidItems.errorCode,
        lastSyncedAt: plaidItems.lastSyncedAt,
        accountCount: sql<number>`(
          select count(*)::int from accounts a where a.plaid_item_id = ${plaidItems.id}
        )`,
      })
      .from(plaidItems)
      .orderBy(plaidItems.createdAt),
    db.select().from(people).where(isNull(people.archivedAt)).orderBy(people.name),
  ]);

  const parents = categoryRows.filter((c) => !c.parentId);
  const total = Number(ruleStats[0]?.total ?? 0);
  const learned = Number(ruleStats[0]?.learned ?? 0);

  return (
    <>
      <PageHeader
        title="Settings"
        actions={
          <form action={logoutAction}>
            <button type="submit" className="btn">Sign out</button>
          </form>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* --- Theme -------------------------------------------------- */}
        <Card className="lg:col-span-2">
          <h2 className="text-lg">Theme</h2>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            Every color in the app reads from these tokens, so a change here
            restyles everything — including light and dark mode independently.
          </p>

          <form action={applyPresetAction} className="mt-4 flex flex-wrap gap-2">
            {THEME_PRESETS.map((p) => (
              <button
                key={p.id}
                type="submit"
                name="presetId"
                value={p.id}
                className="btn flex-col !items-start gap-0.5 !py-2 text-left"
                title={p.description}
              >
                <span className="font-medium">{p.name}</span>
                <span className="text-xs font-normal text-[var(--color-ink-muted)]">
                  {p.description}
                </span>
              </button>
            ))}
          </form>

          <form action={saveThemeAction} className="mt-6">
            <div className="grid gap-6 md:grid-cols-3">
              {EDITABLE_TOKENS.map((group) => (
                <fieldset key={group.group}>
                  <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--color-ink-faint)]">
                    {group.group}
                  </legend>
                  <div className="space-y-2">
                    {group.tokens.map((t) => (
                      <div key={t.key} className="flex items-center justify-between gap-2">
                        <label htmlFor={`token-${t.key}`} className="truncate text-sm">
                          {t.label}
                        </label>
                        <input
                          id={`token-${t.key}`}
                          name={`token.${t.key}`}
                          type={t.type === "color" ? "color" : "text"}
                          defaultValue={theme[t.key] ?? ""}
                          className={t.type === "color" ? "size-8 shrink-0 cursor-pointer rounded border border-[var(--color-border-strong)] bg-transparent p-0.5" : "field !w-24 !py-1 text-xs"}
                        />
                      </div>
                    ))}
                  </div>
                </fieldset>
              ))}
            </div>
            <button type="submit" className="btn btn-primary mt-5">Save theme</button>
          </form>
        </Card>

        {/* --- MCP ------------------------------------------------------ */}
        <Card className="lg:col-span-2">
          <h2 className="text-lg">Talk to your ledger</h2>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            Connect Claude to this app over MCP and you can just say what you
            bought. Entries logged that way are matched to the real charge when
            you import the statement, so nothing is ever counted twice.
          </p>

          {params.token ? (
            <div className="mt-4 rounded-[var(--radius-token)] border border-[var(--color-accent)] bg-[var(--color-accent-soft)] p-4">
              <p className="text-sm font-medium">
                Here is your token. It is shown once and only its hash is
                stored, so copy it now.
              </p>
              <code className="figure mt-2 block overflow-x-auto rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-xs">
                {params.token}
              </code>
              <p className="mt-3 text-xs text-[var(--color-ink-muted)]">
                Add it to Claude with:
              </p>
              <code className="figure mt-1 block overflow-x-auto rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-xs">
                claude mcp add --transport http loot &lt;your-url&gt;/api/mcp --header
                &quot;Authorization: Bearer {params.token}&quot;
              </code>
            </div>
          ) : null}

          {tokens.length > 0 ? (
            <ul className="mt-4 divide-y divide-[var(--color-border)]">
              {tokens.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span>
                    {t.name}
                    <span className="ml-2 text-xs text-[var(--color-ink-faint)]">
                      {t.lastUsedAt
                        ? `last used ${t.lastUsedAt.toISOString().slice(0, 10)}`
                        : "never used"}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className={`chip ${t.revoked ? "!border-[var(--color-negative)] !text-[var(--color-negative)]" : ""}`}>
                      {t.revoked ? "Revoked" : "Active"}
                    </span>
                    {t.revoked ? null : (
                      <form action={revokeMcpTokenAction}>
                        <input type="hidden" name="tokenId" value={t.id} />
                        <button
                          type="submit"
                          className="text-xs text-[var(--color-ink-faint)] underline underline-offset-4 hover:text-[var(--color-negative)]"
                        >
                          Revoke
                        </button>
                      </form>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          <form action={issueMcpTokenAction} className="mt-4 flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="token-name" className="mb-1 block text-xs font-medium">
                Name this connection
              </label>
              <input id="token-name" name="name" placeholder="Claude on my laptop" className="field !w-56" />
            </div>
            <button type="submit" className="btn btn-primary">Issue a token</button>
          </form>
        </Card>

        {/* --- Alerts -------------------------------------------------- */}
        <Card>
          <h2 className="text-lg">Alerts</h2>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            Sent when something is worth interrupting you for: a charge far
            larger than usual, a cushion below two weeks, spending running ahead
            of a normal month, or a card whose spending is invisible. Most days
            there is nothing to say and nothing is sent.
          </p>
          <PushToggle />

          <div className="mt-4 border-t border-[var(--color-border)] pt-3">
            <h3 className="text-sm font-medium">Text messages</h3>
            {hasSms ? (
              <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
                Texting alerts to{" "}
                <span className="figure">{env.ALERT_PHONE}</span>. Every message
                costs money, so only the same alerts are sent — nothing routine.
              </p>
            ) : (
              <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
                Off. Set <code>TWILIO_ACCOUNT_SID</code>,{" "}
                <code>TWILIO_AUTH_TOKEN</code>, <code>TWILIO_FROM</code> and{" "}
                <code>ALERT_PHONE</code> to turn it on. Unlike browser
                notifications, each text is billed, which is why the alert rules
                stay as quiet as they do.
              </p>
            )}
          </div>
          <p className="mt-3 text-xs text-[var(--color-ink-muted)]">
            Delivered by web push — a browser standard, with no third-party
            service between this deployment and your devices. Enabled per device,
            since a subscription belongs to a browser rather than to an account.
          </p>
        </Card>

        {/* --- Household ---------------------------------------------- */}
        <Card>
          <h2 className="text-lg">Household</h2>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            Used only to scale the published averages on Buffer &amp; goals. A
            per-person grocery figure means nothing without it, and assuming one
            person would tell a family they overspend on everything.
          </p>
          <form action={setHouseholdAction} className="mt-4 flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="adults" className="mb-1 block text-xs font-medium">Adults</label>
              <input id="adults" name="adults" type="number" min="1" max="12"
                defaultValue={home.adults} className="field !w-20" />
            </div>
            <div>
              <label htmlFor="children" className="mb-1 block text-xs font-medium">Children</label>
              <input id="children" name="children" type="number" min="0" max="12"
                defaultValue={home.children} className="field !w-20" />
            </div>
            <div>
              <label htmlFor="country" className="mb-1 block text-xs font-medium">Country</label>
              <input id="country" name="country" maxLength={2}
                defaultValue={home.country} className="field !w-20" />
            </div>
            <div>
              <label htmlFor="region" className="mb-1 block text-xs font-medium">
                State <span className="text-[var(--color-ink-faint)]">(US)</span>
              </label>
              <input id="region" name="region" maxLength={2} placeholder="CO"
                defaultValue={home.region ?? ""} className="field !w-20" />
            </div>
            <button type="submit" className="btn">Save</button>
          </form>
          <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
            State adjusts the national averages for local price levels — the
            largest single correction available, since a national mean compared
            against an expensive metro is wrong in a known direction. Leave it
            blank and you get the unadjusted national figure. Benchmarks ship
            for the US only; other countries show no comparison rather than a
            wrong one.
          </p>
        </Card>

        {/* --- Ledger mode -------------------------------------------- */}
        <Card>
          <h2 className="text-lg">Ledger type</h2>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            A business ledger answers a different question — what the profit is
            and what is deductible — so it uses its own chart of accounts and
            reports a P&amp;L instead of a savings rate.
          </p>

          <form action={setLedgerModeAction} className="mt-4 space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              {(["personal", "business"] as const).map((m) => (
                <label
                  key={m}
                  className={`flex cursor-pointer items-start gap-2 rounded border p-3 text-sm ${
                    mode === m
                      ? "border-[var(--color-accent)] bg-[var(--color-bg-subtle)]"
                      : "border-[var(--color-border)]"
                  }`}
                >
                  <input
                    type="radio"
                    name="mode"
                    value={m}
                    defaultChecked={mode === m}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block font-medium capitalize">{m}</span>
                    <span className="block text-xs text-[var(--color-ink-muted)]">
                      {m === "personal"
                        ? "Household categories, budgets, savings rate."
                        : "Revenue, COGS, operating expenses, deductibility."}
                    </span>
                  </span>
                </label>
              ))}
            </div>

            <div>
              <label htmlFor="biz-name" className="mb-1 block text-xs font-medium">
                Business name <span className="text-[var(--color-ink-faint)]">(optional)</span>
              </label>
              <input
                id="biz-name"
                name="businessName"
                defaultValue={bizName ?? ""}
                placeholder="Shown on reports and the year-end export"
                className="field"
              />
            </div>

            <button type="submit" className="btn">Save</button>
            <p className="text-xs text-[var(--color-ink-muted)]">
              Switching keeps every transaction and its category. Nothing is
              reclassified until you run <code>pnpm db:reclassify</code>.
            </p>
          </form>
        </Card>

        {mode === "business" ? (
          <>
            {/* --- Business logo ---------------------------------------- */}
            <Card>
              <h2 className="text-lg">Business logo</h2>
              <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
                Shown on business reports. Square, around 512px, works best —
                it is shown exactly as uploaded, with no resizing.
              </p>

              {logo ? (
                <div className="mt-3 flex items-center gap-3">
                  <img
                    src={`data:${logo.mimeType};base64,${logo.data}`}
                    alt="Business logo"
                    className="size-16 rounded border border-[var(--color-border)] object-contain"
                  />
                  <form action={removeBusinessLogoAction}>
                    <button
                      type="submit"
                      className="text-xs text-[var(--color-ink-faint)] underline underline-offset-4 hover:text-[var(--color-negative)]"
                    >
                      Remove
                    </button>
                  </form>
                </div>
              ) : null}

              <form action={updateBusinessLogoAction} className="mt-4 space-y-3">
                {/*
                  `accept` and the limit below both come from the same
                  constants the server validates against, so the picker cannot
                  offer a file the upload will silently drop.
                */}
                <input
                  type="file"
                  name="logo"
                  accept={LOGO_ALLOWED_MIME_TYPES.join(",")}
                  className="field"
                />
                <button type="submit" className="btn">Save</button>
                <p className="text-xs text-[var(--color-ink-muted)]">
                  PNG, JPEG or WebP, up to {LOGO_MAX_BYTES / 1024 / 1024}MB.
                </p>
              </form>
            </Card>

            {/* --- Team ---------------------------------------------------- */}
            <Card>
              <h2 className="text-lg">Team</h2>
              <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
                A roster of who you pay, for your own reference. Not linked to
                any transaction or report — add employees and contractors
                here to keep track of them, nothing more.
              </p>

              {personRows.length > 0 ? (
                <ul className="mt-3 divide-y divide-[var(--color-border)]">
                  {personRows.map((p) => (
                    <li key={p.id} className="py-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span>
                          {p.name}
                          {p.email ? (
                            <span className="ml-2 text-xs text-[var(--color-ink-faint)]">{p.email}</span>
                          ) : null}
                        </span>
                        <span className="flex items-center gap-3">
                          <span className="chip">{p.type}</span>
                          <form action={archivePersonAction}>
                            <input type="hidden" name="personId" value={p.id} />
                            <button
                              type="submit"
                              className="text-xs text-[var(--color-ink-faint)] underline underline-offset-4 hover:text-[var(--color-negative)]"
                            >
                              Archive
                            </button>
                          </form>
                        </span>
                      </div>

                      {/*
                        Disclosure rather than a toggle, so the row stays a
                        server component — same pattern as the split form on a
                        transaction.
                      */}
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs text-[var(--color-ink-faint)] underline underline-offset-4 hover:text-[var(--color-ink)]">
                          Edit
                        </summary>
                        <form action={updatePersonAction} className="mt-2 space-y-2">
                          <input type="hidden" name="personId" value={p.id} />
                          <input
                            name="name" defaultValue={p.name} aria-label="Name"
                            className="field"
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <select name="type" defaultValue={p.type} aria-label="Type" className="field">
                              {PERSON_TYPES.map((t) => (
                                <option key={t} value={t}>
                                  {t.charAt(0).toUpperCase() + t.slice(1)}
                                </option>
                              ))}
                            </select>
                            <input
                              name="email" defaultValue={p.email ?? ""} placeholder="Email"
                              aria-label="Email" className="field"
                            />
                          </div>
                          <input
                            name="note" defaultValue={p.note ?? ""} placeholder="Note"
                            aria-label="Note" className="field"
                          />
                          <button type="submit" className="btn">Save</button>
                        </form>
                      </details>
                    </li>
                  ))}
                </ul>
              ) : null}

              <form action={createPersonAction} className="mt-4 space-y-3">
                <div>
                  <label htmlFor="person-name" className="mb-1 block text-xs font-medium">Name</label>
                  <input id="person-name" name="name" placeholder="Ada Lovelace" className="field" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="person-type" className="mb-1 block text-xs font-medium">Type</label>
                    {/*
                      Driven by PERSON_TYPES, which is also what the action
                      validates against — a hand-written list here would let
                      the two drift, and the one that loses is the option the
                      form offers but the server rejects.
                    */}
                    <select id="person-type" name="type" className="field">
                      {PERSON_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t.charAt(0).toUpperCase() + t.slice(1)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="person-email" className="mb-1 block text-xs font-medium">
                      Email <span className="text-[var(--color-ink-faint)]">(optional)</span>
                    </label>
                    <input id="person-email" name="email" placeholder="ada@example.com" className="field" />
                  </div>
                </div>
                <button type="submit" className="btn">Add</button>
              </form>
            </Card>
          </>
        ) : null}

        {/* --- Connected banks ---------------------------------------- */}
        <Card>
          <h2 className="text-lg">Connected banks</h2>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            Pull transactions automatically instead of uploading statements.
            Syncing starts the day after an account&rsquo;s last imported
            transaction, so linking a bank you have already imported will not
            duplicate that history.
          </p>
          <PlaidLinkButton
            configured={hasPlaid}
            environment={env.PLAID_ENV}
            items={plaidRows.map((i) => ({
              ...i,
              lastSyncedAt: i.lastSyncedAt ? i.lastSyncedAt.toISOString() : null,
            }))}
          />
        </Card>

        {/* --- Accounts ----------------------------------------------- */}
        <Card>
          <h2 className="text-lg">Accounts</h2>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            Optional. Naming your accounts lets imports attach to the right one
            and keeps the dedupe fingerprint per-account.
          </p>

          {accountRows.length > 0 ? (
            <ul className="mt-3 divide-y divide-[var(--color-border)]">
              {accountRows.map((a) => (
                <li key={a.id} className="py-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span>
                      {a.name}
                      {a.institution ? (
                        <span className="ml-2 text-xs text-[var(--color-ink-faint)]">{a.institution}</span>
                      ) : null}
                    </span>
                    <span className="chip">
                      {a.kind.replace("_", " ")}
                      {a.last4 ? ` ••${a.last4}` : ""}
                    </span>
                  </div>

                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-[var(--color-ink-faint)] underline underline-offset-4 hover:text-[var(--color-ink)]">
                      Edit
                    </summary>
                    <form action={updateAccountAction} className="mt-2 space-y-2">
                      <input type="hidden" name="accountId" value={a.id} />
                      <input name="name" defaultValue={a.name} aria-label="Name" className="field" />
                      <div className="grid grid-cols-2 gap-2">
                        <select name="kind" defaultValue={a.kind} aria-label="Type" className="field">
                          {ACCOUNT_KINDS.map((k) => (
                            <option key={k.value} value={k.value}>{k.label}</option>
                          ))}
                        </select>
                        <input
                          name="last4" defaultValue={a.last4 ?? ""} placeholder="Last 4"
                          maxLength={4} aria-label="Last 4" className="field"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          name="institution" defaultValue={a.institution ?? ""} placeholder="Institution"
                          aria-label="Institution" className="field"
                        />
                        <input
                          name="balance" inputMode="decimal" placeholder="Balance"
                          defaultValue={a.balanceCents === null ? "" : (a.balanceCents / 100).toFixed(2)}
                          aria-label="Balance" className="field"
                        />
                      </div>
                      <p className="text-xs text-[var(--color-ink-faint)]">
                        A balance is the one thing statements cannot tell the
                        ledger. Set it here and it counts toward net worth; leave
                        it blank and the account is treated as unknown rather
                        than empty. On a card or a loan, enter what is owed.
                      </p>
                      <button type="submit" className="btn">Save</button>
                    </form>
                  </details>
                </li>
              ))}
            </ul>
          ) : null}

          <form action={createAccountAction} className="mt-4 space-y-3">
            <div>
              <label htmlFor="acct-name" className="mb-1 block text-xs font-medium">Name</label>
              <input id="acct-name" name="name" placeholder="Everyday checking" className="field" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="acct-kind" className="mb-1 block text-xs font-medium">Type</label>
                <select id="acct-kind" name="kind" className="field">
                  {ACCOUNT_KINDS.map((k) => (
                    <option key={k.value} value={k.value}>{k.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="acct-last4" className="mb-1 block text-xs font-medium">Last 4</label>
                <input id="acct-last4" name="last4" placeholder="4321" maxLength={4} className="field" />
              </div>
            </div>
            <button type="submit" className="btn">Add account</button>
          </form>
        </Card>

        {/* --- Classification ----------------------------------------- */}
        <Card>
          <h2 className="text-lg">Classification</h2>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            {total} rules, {learned} of them learned from your corrections.
            {hasLlm
              ? " Claude handles whatever the rules miss."
              : " No Claude API key is set, so anything the rules miss stays uncategorized."}
          </p>

          {topRules.length > 0 ? (
            <>
              <h3 className="mt-4 text-xs font-medium uppercase tracking-wide text-[var(--color-ink-faint)]">
                Most-used rules
              </h3>
              <ul className="mt-2 divide-y divide-[var(--color-border)]">
                {topRules.map((r) => (
                  <li key={r.pattern} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                    <span className="figure truncate text-xs">{r.pattern}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="text-xs text-[var(--color-ink-muted)]">{r.categoryName}</span>
                      <span className="chip">{r.hitCount}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </Card>

        {/* --- Export ------------------------------------------------- */}
        <Card className="lg:col-span-2">
          <h2 className="text-lg">Export your data</h2>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            {/*
              Stated plainly because the promise is worth nothing if leaving is
              hard. Every correction and learned rule is original work that
              exists nowhere else.
            */}
            Everything in this ledger, whenever you want it. The CSV opens in a
            spreadsheet; the JSON carries the categories, rules and corrections
            as well, which is what another deployment would need.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href="/api/export?format=csv" className="btn">
              Transactions (CSV)
            </a>
            <a href="/api/export?format=json" className="btn">
              Everything (JSON)
            </a>
          </div>
          <p className="mt-3 text-xs text-[var(--color-ink-faint)]">
            Bank access tokens, push subscriptions and API tokens are left out.
            None of them is your ledger, and the first is a live credential.
          </p>
        </Card>

        {/* --- Categories --------------------------------------------- */}
        <Card className="lg:col-span-2">
          <h2 className="text-lg">Categories</h2>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            {categoryRows.length} categories. Adding one makes it immediately
            available to the classifier — the description you give it is what
            Claude uses to decide what belongs there.
          </p>

          <form action={createCategoryAction} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label htmlFor="cat-name" className="mb-1 block text-xs font-medium">Name</label>
              <input id="cat-name" name="name" placeholder="Bike maintenance" className="field" />
            </div>
            <div>
              <label htmlFor="cat-parent" className="mb-1 block text-xs font-medium">Group</label>
              <select id="cat-parent" name="parentId" className="field">
                <option value="">None</option>
                {parents.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
              </select>
            </div>
            <div>
              <label htmlFor="cat-kind" className="mb-1 block text-xs font-medium">Kind</label>
              <select id="cat-kind" name="kind" className="field">
                <option value="expense">Expense</option>
                <option value="income">Income</option>
                <option value="transfer">Transfer</option>
              </select>
            </div>
            <div>
              <label htmlFor="cat-hint" className="mb-1 block text-xs font-medium">
                What belongs here
              </label>
              <input id="cat-hint" name="hint" placeholder="Bike shops, parts, repairs" className="field" />
            </div>
            <div className="sm:col-span-2 lg:col-span-4">
              <button type="submit" className="btn">Add category</button>
            </div>
          </form>
        </Card>
      </div>
    </>
  );
}
