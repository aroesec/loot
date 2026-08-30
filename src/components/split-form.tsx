"use client";

import { useState } from "react";
import { divideEvenly, validateSplit } from "@/lib/split-math";
import { formatCents } from "@/lib/money";
import { splitTransactionAction } from "@/app/actions";

/**
 * Dividing one transaction across categories.
 *
 * The running remainder is the whole interface. A split is rejected unless the
 * parts sum exactly, so the useful thing to show is not a validation error
 * after submitting but how far off you currently are, updated as you type.
 */

type Category = { id: string; name: string; slug: string };
type Part = { amount: string; categoryId: string };

export function SplitForm({
  transactionId,
  amountCents,
  categoryId,
  categories,
  suggestion,
}: {
  transactionId: string;
  amountCents: number;
  categoryId: string | null;
  categories: Category[];
  /** How this merchant was split last time, already applied to this amount. */
  suggestion?: { categoryId: string; amountCents: number }[] | null;
}) {
  const dollars = (cents: number) => (cents / 100).toFixed(2);

  const [parts, setParts] = useState<Part[]>(() => {
    /*
     * Filled in from the last split of this merchant when there is one. The
     * suggestion is never applied on its own — the tedium worth removing is
     * re-typing the same two categories every week, not the deciding, and the
     * same shop is 70/30 one week and entirely household the next.
     */
    if (suggestion?.length) {
      // Signed to match the transaction: the amounts arrive as magnitudes.
      const sign = amountCents < 0 ? -1 : 1;
      return suggestion.map((p) => ({
        amount: dollars(p.amountCents * sign),
        categoryId: p.categoryId,
      }));
    }
    const halves = divideEvenly(amountCents, 2);
    return halves.map((c) => ({ amount: dollars(c), categoryId: categoryId ?? categories[0]?.id ?? "" }));
  });
  const [error, setError] = useState<string | null>(null);

  const asCents = parts.map((p) => Math.round(Number(p.amount) * 100));
  const check = validateSplit(
    amountCents,
    asCents.map((c, i) => ({ amountCents: c, categoryId: parts[i]!.categoryId })),
  );
  const remainder =
    amountCents - asCents.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);

  const update = (i: number, patch: Partial<Part>) =>
    setParts((prev) => prev.map((p, n) => (n === i ? { ...p, ...patch } : p)));

  // Two cents cannot go three ways, so the control that would ask for that is
  // not offered.
  const canAddPart = parts.length < Math.abs(amountCents);

  const addPart = () =>
    setParts((prev) => [
      ...prev,
      // Pre-filled with whatever is left, which is usually what you want.
      { amount: dollars(remainder), categoryId: categories[0]?.id ?? "" },
    ]);

  const even = () =>
    setParts((prev) =>
      divideEvenly(amountCents, prev.length).map((c, i) => ({
        ...prev[i]!,
        amount: dollars(c),
      })),
    );

  return (
    <form
      action={async (fd) => setError((await splitTransactionAction(fd)) ?? null)}
      className="mt-3 space-y-2"
    >
      <input type="hidden" name="transactionId" value={transactionId} />

      <p className="text-xs text-[var(--color-ink-muted)]">
        Splitting {formatCents(amountCents)}. The parts have to add up to it
        exactly.
        {suggestion?.length ? (
          <>
            {" "}
            Filled in the way you last split this merchant — change anything
            that is different this time.
          </>
        ) : null}
      </p>

      {parts.map((p, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2">
          <label className="text-xs">
            <span className="mb-1 block text-[var(--color-ink-muted)]">Amount</span>
            <input
              name="amount"
              value={p.amount}
              inputMode="decimal"
              onChange={(e) => update(i, { amount: e.target.value })}
              className="field !w-28"
            />
          </label>

          <label className="min-w-44 flex-1 text-xs">
            <span className="mb-1 block text-[var(--color-ink-muted)]">Category</span>
            <select
              name="categoryId"
              value={p.categoryId}
              onChange={(e) => update(i, { categoryId: e.target.value })}
              className="field"
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          {parts.length > 2 ? (
            <button
              type="button"
              onClick={() => setParts((prev) => prev.filter((_, n) => n !== i))}
              className="mb-1.5 text-xs text-[var(--color-ink-faint)] underline underline-offset-4"
            >
              Remove
            </button>
          ) : null}
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-3 text-xs">
        {canAddPart ? (
          <button type="button" onClick={addPart} className="underline underline-offset-4">
            Add a part
          </button>
        ) : null}
        <button type="button" onClick={even} className="underline underline-offset-4">
          Divide evenly
        </button>

        {/*
          The remainder for a sum mismatch, because "$4.00 left to assign" is
          more use than "the parts are short". For anything else, the actual
          problem.
          
          Showing only the remainder meant a zero part or a part pointing the
          wrong way left this reading a green "Adds up" beside a disabled submit
          button, with nothing on screen explaining the disagreement.
        */}
        <span
          className={
            check.ok ? "text-[var(--color-positive)]" : "text-[var(--color-negative)]"
          }
        >
          {check.ok
            ? "Adds up"
            : check.problem.kind === "sum-mismatch"
              ? `${formatCents(Math.abs(remainder))} ${
                  Math.abs(asCents.reduce((a, b) => a + b, 0)) < Math.abs(amountCents)
                    ? "left to assign"
                    : "over"
                }`
              : check.problem.message}
        </span>
      </div>

      {error ? <p className="text-sm text-[var(--color-negative)]">{error}</p> : null}

      <button type="submit" className="btn btn-primary" disabled={!check.ok}>
        Split into {parts.length}
      </button>
    </form>
  );
}
