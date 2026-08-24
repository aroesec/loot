import {
  attributeCardPayments,
  unsettledCharges,
  unlinkedCards,
} from "@/lib/reconcile/card-payments";
import { formatCents } from "@/lib/money";

/**
 * "Where did that card payment actually go."
 *
 * The ledger counts charges when they happen and excludes the payment, which
 * is the only way to avoid double-counting. The cost is that a large payment
 * leaving the account has no visible destination. This puts the two back
 * together without changing either number.
 */
async function main() {
  const payments = await attributeCardPayments();

  if (payments.length === 0) {
    console.log("No card payments found on any linked card account.");
  }

  for (const p of payments) {
    const window = p.windowStart
      ? `${p.windowStart} → ${p.windowEnd}`
      : `everything up to ${p.windowEnd}`;

    console.log(`\n${p.accountName} — paid ${formatCents(p.amountCents)} on ${p.paidOn}`);
    console.log(`  settles ${p.chargeCount} charges over ${window}`);
    console.log(`  charges in window: ${formatCents(p.chargesCents)}`);

    if (p.coverage !== null) {
      const pct = (p.coverage * 100).toFixed(0);
      const note =
        p.coverage > 1.05
          ? "also clearing an earlier balance"
          : p.coverage < 0.95
            ? "a balance was carried forward"
            : "paid in full";
      console.log(`  coverage: ${pct}% — ${note}`);
    }

    for (const c of p.categories.slice(0, 8)) {
      const share = p.chargesCents > 0 ? (c.amountCents / p.chargesCents) * 100 : 0;
      console.log(
        `    ${c.name.padEnd(24)} ${formatCents(c.amountCents).padStart(10)}  ` +
          `${share.toFixed(0).padStart(3)}%  (${c.count})`,
      );
    }
  }

  const carried = await unsettledCharges();
  if (carried.length > 0) {
    console.log("\n=== Charged but not yet paid ===");
    console.log("  Counted as spending, but the money has not left a bank account.");
    for (const c of carried) {
      console.log(
        `  ${c.accountName.padEnd(24)} ${formatCents(c.amountCents).padStart(11)}  ` +
          `${c.count} charges since ${c.sinceOn ?? "the beginning"}`,
      );
    }
  }

  const blind = await unlinkedCards();
  if (blind.length > 0) {
    console.log("\n=== Cards with payments but no charges ===");
    console.log("  Nothing represents what these cards were used for.");
    for (const b of blind) {
      console.log(
        `  ${b.accountName.padEnd(24)} ${formatCents(b.paymentsCents).padStart(11)} across ${b.count} payment(s)`,
      );
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("card audit failed", err);
  process.exit(1);
});
