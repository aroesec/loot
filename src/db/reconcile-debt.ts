import { reconcileCardPayments } from "@/lib/reconcile/debt";
import { formatCents } from "@/lib/money";

/**
 * Keep card payments on the right side of the line, in both directions.
 *
 * Safe to run repeatedly, and worth running after any import or sync: linking
 * a card should move its payments back to transfers, and that is exactly the
 * moment a double-count would otherwise appear.
 */
async function main() {
  const r = await reconcileCardPayments();

  console.log(
    `${r.toDebt} payment(s) → Debt Payments (now counted)\n` +
      `${r.toTransfer} payment(s) → Credit Card Payments (now excluded again)`,
  );

  if (r.issuers.length === 0) {
    console.log("\nEvery card payment is backed by imported charges.");
    process.exit(0);
  }

  console.log("\nCards the ledger cannot account for:");
  for (const i of r.issuers) {
    const why =
      i.reason === "no-account"
        ? "no account for this card at all"
        : "account exists but holds no charges";
    console.log(
      `  ${i.issuer.padEnd(22)} ${formatCents(i.paymentsCents).padStart(11)}  ` +
        `${i.paymentCount} payment(s), ${i.earliestPaymentOn}..${i.latestPaymentOn}`,
    );
    console.log(`    ${why} — link or import it to see what was bought`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("reconcile failed", err);
  process.exit(1);
});
