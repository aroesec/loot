import { and, eq, isNull, or } from "drizzle-orm";
import { CountryCode, Products, type AccountBase } from "plaid";
import { db } from "@/db";
import { accounts, plaidItems } from "@/db/schema";
import { plaidClient } from "./client";
import { encryptToken } from "./crypto";

/**
 * Plaid's account types map onto this ledger's `account_kind` closely enough
 * that guessing is unnecessary. `subtype` is more specific than `type` and is
 * preferred where it says something useful.
 */
function toAccountKind(
  account: AccountBase,
): "checking" | "savings" | "credit_card" | "investment" | "loan" | "cash" {
  const subtype = String(account.subtype ?? "");
  if (subtype === "checking") return "checking";
  if (subtype === "savings" || subtype === "money market") return "savings";
  if (subtype === "credit card") return "credit_card";

  switch (account.type) {
    case "credit":
      return "credit_card";
    case "investment":
      return "investment";
    case "loan":
      return "loan";
    case "depository":
      return "checking";
    default:
      return "cash";
  }
}

/**
 * How much history to ask a bank for, in days.
 *
 * Plaid defaults to **90 days** when this is omitted, which is easy to miss
 * because nothing reports it — the Item links, transactions arrive, and only a
 * report needing several complete months reveals that the history stops three
 * months back. Two years is the usual ceiling; institutions that offer less
 * simply return what they have.
 */
const HISTORY_DAYS = 730;

export async function createLinkToken(userId: string): Promise<string> {
  const client = plaidClient();
  const res = await client.linkTokenCreate({
    user: { client_user_id: userId },
    client_name: "Loot",
    products: [Products.Transactions],
    country_codes: [CountryCode.Us],
    language: "en",
    transactions: { days_requested: HISTORY_DAYS },
  });
  return res.data.link_token;
}

/**
 * Re-auth for an Item whose login broke. Passing the access token puts Link in
 * update mode, which repairs the existing Item rather than creating a second
 * one — important on the free tier, where new Items are a finite lifetime
 * allowance.
 */
export async function createUpdateLinkToken(
  userId: string,
  accessToken: string,
): Promise<string> {
  const client = plaidClient();
  const res = await client.linkTokenCreate({
    user: { client_user_id: userId },
    client_name: "Loot",
    country_codes: [CountryCode.Us],
    language: "en",
    access_token: accessToken,
    /*
     * Also carried here, because update mode is the only way to extend the
     * history of an Item that was already created with a shorter window. A
     * connection linked under the 90-day default stays at 90 days forever
     * otherwise, however many times it syncs.
     */
    transactions: { days_requested: HISTORY_DAYS },
  });
  return res.data.link_token;
}

export type ExchangeResult = {
  itemRowId: string;
  institution: string;
  accountsLinked: number;
  accountsAdopted: number;
};

/**
 * Trade the short-lived public token for a long-lived access token, then
 * create or adopt an account row per account behind the login.
 *
 * Adoption matters: the ledger already has hand-made accounts with real
 * history. Matching on `last4` attaches the linked account to the existing one
 * instead of creating a second copy, which would split the history in two and
 * put the two halves in different dedupe namespaces.
 */
export async function exchangePublicToken(
  publicToken: string,
): Promise<ExchangeResult> {
  const client = plaidClient();

  const exchange = await client.itemPublicTokenExchange({
    public_token: publicToken,
  });
  const accessToken = exchange.data.access_token;
  const itemId = exchange.data.item_id;

  const accountsRes = await client.accountsGet({ access_token: accessToken });
  const institutionId = accountsRes.data.item.institution_id ?? null;

  let institutionName: string | null = null;
  if (institutionId) {
    try {
      const inst = await client.institutionsGetById({
        institution_id: institutionId,
        country_codes: [CountryCode.Us],
      });
      institutionName = inst.data.institution.name;
    } catch {
      // Cosmetic only — a missing display name must not fail the link.
    }
  }

  const [item] = await db
    .insert(plaidItems)
    .values({
      itemId,
      accessTokenEncrypted: encryptToken(accessToken),
      institutionId,
      institutionName,
    })
    .onConflictDoUpdate({
      target: plaidItems.itemId,
      // Re-linking the same institution refreshes the token in place.
      set: {
        accessTokenEncrypted: encryptToken(accessToken),
        status: "active",
        errorCode: null,
      },
    })
    .returning({ id: plaidItems.id });

  const itemRowId = item!.id;
  let linked = 0;
  let adopted = 0;

  for (const account of accountsRes.data.accounts) {
    const last4 = account.mask ?? null;

    /*
     * Adopt an existing account rather than creating a second copy — a split
     * account puts one history into two dedupe namespaces.
     *
     * But last4 is only four digits and is not unique across banks: two
     * institutions can easily both end in 1234. Adopting a row that already
     * belongs to a *different* Item would hand one bank's account to another
     * and start writing the wrong transactions into it. So only unlinked rows,
     * or rows already belonging to this same Item, are eligible.
     */
    const existing = last4
      ? await db
          .select({ id: accounts.id, plaidAccountId: accounts.plaidAccountId })
          .from(accounts)
          .where(
            and(
              eq(accounts.last4, last4),
              or(
                isNull(accounts.plaidItemId),
                eq(accounts.plaidItemId, itemRowId),
              ),
            ),
          )
          .limit(1)
      : [];

    if (existing[0]) {
      await db
        .update(accounts)
        .set({
          plaidAccountId: account.account_id,
          plaidItemId: itemRowId,
          institution: institutionName ?? undefined,
        })
        .where(eq(accounts.id, existing[0].id));
      adopted += 1;
      continue;
    }

    await db.insert(accounts).values({
      name: account.name,
      kind: toAccountKind(account),
      institution: institutionName,
      last4,
      plaidAccountId: account.account_id,
      plaidItemId: itemRowId,
    });
    linked += 1;
  }

  return {
    itemRowId,
    institution: institutionName ?? "Your bank",
    accountsLinked: linked,
    accountsAdopted: adopted,
  };
}
