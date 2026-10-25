export type ActualMovement = {
  id: string;
  amountCents: number;
  isTransfer: boolean;
  status: string;
  fundingSide: boolean;
  fundKind: "savings" | "investment" | null;
};

/** Only cleared ledger movements, never budgets or scheduled contributions. */
export function calculateActuals(rows: ActualMovement[]) {
  let incomeCents = 0,
    spentCents = 0,
    savingsCents = 0,
    investmentCents = 0,
    contributedCents = 0,
    withdrawnCents = 0,
    pendingCount = 0;
  for (const row of new Map(rows.map((row) => [row.id, row])).values()) {
    if (row.status !== "cleared") {
      pendingCount++;
      continue;
    }
    if (!row.isTransfer) {
      if (row.amountCents > 0) incomeCents += row.amountCents;
      else spentCents -= row.amountCents;
    } else if (row.fundingSide && row.fundKind) {
      const net = -row.amountCents;
      if (row.fundKind === "savings") savingsCents += net;
      else investmentCents += net;
      if (net > 0) contributedCents += net;
      else withdrawnCents -= net;
    }
  }
  const savedCents = savingsCents + investmentCents;
  const leftCents = incomeCents - spentCents - savedCents;
  return {
    incomeCents,
    spentCents,
    savingsCents,
    investmentCents,
    contributedCents,
    withdrawnCents,
    savedCents,
    leftCents,
    furtherSavingsCents: Math.max(0, leftCents),
    pendingCount,
  };
}
