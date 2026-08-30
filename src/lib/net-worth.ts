/**
 * Net worth, and how much of it is actually known.
 *
 * DB-free so the arithmetic and — more importantly — the coverage rules are
 * testable without a database.
 *
 * **The whole difficulty is that this app is built from flows.** Every other
 * figure here is derived from transactions, which are complete by construction:
 * a statement either was imported or was not. A balance is a *stock*, and the
 * only things that produce one are a linked bank or someone typing it in. An
 * account with no balance is not worth zero — it is unknown, and the difference
 * between those two is the entire reason this module reports coverage instead
 * of just a number.
 *
 * Silently treating unknown as zero is the failure mode. A household with a
 * linked current account and an unlinked mortgage would be shown a large
 * positive net worth that is wrong by the size of a house, and nothing about it
 * would look odd.
 */

export type AccountKind =
  | "checking"
  | "savings"
  | "credit_card"
  | "investment"
  | "loan"
  | "cash";

/**
 * Which side of the balance sheet each kind sits on.
 *
 * Investments count here where the cash buffer deliberately excludes them: a
 * buffer asks what could be spent this month without selling anything, and net
 * worth asks what you own. Same balances, different question.
 */
const SIDE: Record<AccountKind, "asset" | "liability"> = {
  checking: "asset",
  savings: "asset",
  cash: "asset",
  investment: "asset",
  credit_card: "liability",
  loan: "liability",
};

export type BalanceInput = {
  kind: AccountKind;
  /** Null means nobody has told us — not zero. */
  balanceCents: number | null;
};

export type NetWorth = {
  assetsCents: number;
  /** Positive: what is owed. */
  liabilitiesCents: number;
  netCents: number;
  accountsKnown: number;
  accountsUnknown: number;
  /** True when no account has a balance at all, so there is no figure to show. */
  unknown: boolean;
};

export function netWorth(balances: BalanceInput[]): NetWorth {
  let assetsCents = 0;
  let liabilitiesCents = 0;
  let accountsKnown = 0;
  let accountsUnknown = 0;

  for (const b of balances) {
    if (b.balanceCents === null) {
      accountsUnknown++;
      continue;
    }
    accountsKnown++;

    if (SIDE[b.kind] === "liability") {
      /*
       * `Math.abs`, because what a card owes arrives signed either way
       * depending on the institution. A sign flip here does not produce a
       * small error, it moves a debt to the asset side and shifts net worth by
       * twice the balance — the same reason `buffer.ts` takes the absolute
       * value rather than trusting the sign.
       */
      liabilitiesCents += Math.abs(b.balanceCents);
    } else {
      assetsCents += b.balanceCents;
    }
  }

  return {
    assetsCents,
    liabilitiesCents,
    netCents: assetsCents - liabilitiesCents,
    accountsKnown,
    accountsUnknown,
    unknown: accountsKnown === 0,
  };
}

/**
 * What to tell someone about how complete the figure is.
 *
 * Returned rather than rendered so the wording is testable and cannot drift
 * between the places that show it.
 */
export function coverageNote(worth: NetWorth): string | null {
  if (worth.unknown) {
    return "No account has a balance yet, so there is no net worth to show. Link a bank, or type a balance in on Settings — the ledger is built from transactions, and a balance is the one thing they cannot tell it.";
  }
  if (worth.accountsUnknown > 0) {
    const n = worth.accountsUnknown;
    return `${n} account${n === 1 ? " has" : "s have"} no balance, so ${n === 1 ? "it is" : "they are"} missing from this figure. An account with no balance is unknown rather than empty — link it, or set a balance on Settings.`;
  }
  return null;
}
