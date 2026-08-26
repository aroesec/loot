import { splitGroups } from "@/lib/split";
import { formatCents } from "@/lib/money";

/**
 * Prove every split still sums to what it replaced.
 *
 * A split is the one operation in this ledger that can change a month's total
 * without any query being wrong: nothing downstream re-checks the arithmetic,
 * because siblings are ordinary rows. This is the check that would catch it.
 */
async function main() {
  const groups = await splitGroups();

  if (groups.length === 0) {
    console.log("No splits in this ledger.");
    return;
  }

  let broken = 0;
  for (const g of groups) {
    const ok = g.sumCents === g.originalCents;
    if (!ok) broken++;
    console.log(
      `${ok ? "ok  " : "DRIFT"} ${g.groupId.slice(0, 8)}  ${g.parts} parts  ` +
        `${formatCents(g.sumCents)} of ${formatCents(g.originalCents)}` +
        (ok ? "" : `  off by ${formatCents(g.sumCents - g.originalCents)}`),
    );
  }

  console.log(`\n${groups.length} split(s), ${broken} with drift`);
  if (broken > 0) process.exit(1);
}

main().then(() => process.exit(0));
