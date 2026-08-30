"use client";

import { useState } from "react";
import { Money } from "./ui";
import {
  recategorizeAction,
  deleteTransactionAction,
  unsplitTransactionAction,
} from "@/app/actions";
import { SplitForm } from "./split-form";
import { REVIEW_THRESHOLD } from "@/lib/classify/constants";
import { formatCents } from "@/lib/money";

type Txn = {
  id: string;
  postedOn: string;
  amountCents: number;
  rawDescription: string;
  merchant: string | null;
  categoryId: string | null;
  categoryName: string | null;
  categorySlug: string | null;
  categoryColor: string | null;
  source: "rule" | "llm" | "manual" | "unclassified";
  confidence: number | null;
  reason: string | null;
  isTransfer: boolean;
  accountName: string | null;
  splitGroupId: string | null;
  splitOriginalCents: number | null;
};

const SOURCE_LABEL: Record<Txn["source"], string> = {
  rule: "Rule",
  llm: "Claude",
  manual: "You",
  unclassified: "Unsorted",
};

export function TransactionRow({
  txn,
  categories,
  splitSuggestion,
}: {
  txn: Txn;
  categories: Array<{ id: string; name: string; slug: string }>;
  /** How this merchant was split last time, already sized to this amount. */
  splitSuggestion?: { categoryId: string; amountCents: number }[] | null;
}) {
  const [open, setOpen] = useState(false);

  const lowConfidence =
    txn.source !== "manual" &&
    txn.confidence !== null &&
    txn.confidence < REVIEW_THRESHOLD;

  return (
    <li className={lowConfidence ? "bg-[var(--color-warning-soft)]" : ""}>
      <div className="flex items-start gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="min-w-0 flex-1 text-left"
        >
          <div className="flex items-baseline gap-2">
            <span className="truncate font-medium">
              {txn.merchant ?? txn.rawDescription}
            </span>
            {txn.isTransfer ? <span className="chip">Transfer</span> : null}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-ink-muted)]">
            <span className="figure">{txn.postedOn}</span>
            {txn.categoryName ? (
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="inline-block size-2 rounded-full"
                  style={{
                    background: txn.categoryColor ?? "var(--color-ink-faint)",
                  }}
                />
                {txn.categoryName}
              </span>
            ) : (
              <span>Uncategorized</span>
            )}
            <span className="text-[var(--color-ink-faint)]">
              {SOURCE_LABEL[txn.source]}
              {txn.confidence !== null && txn.source === "llm"
                ? ` ${Math.round(txn.confidence * 100)}%`
                : ""}
            </span>
            {txn.accountName ? (
              <span className="text-[var(--color-ink-faint)]">
                {txn.accountName}
              </span>
            ) : null}
          </div>
        </button>

        <Money cents={txn.amountCents} className="shrink-0 pt-0.5 text-sm" />
      </div>

      {open ? (
        <div className="border-t border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-4 py-4">
          <dl className="mb-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-[var(--color-ink-muted)]">On the statement</dt>
            <dd className="figure break-words text-xs">{txn.rawDescription}</dd>
            {txn.reason ? (
              <>
                <dt className="text-[var(--color-ink-muted)]">Why this category</dt>
                <dd>{txn.reason}</dd>
              </>
            ) : null}
          </dl>

          <form action={recategorizeAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="transactionId" value={txn.id} />
            <div className="min-w-48 flex-1">
              <label
                htmlFor={`cat-${txn.id}`}
                className="mb-1 block text-xs font-medium"
              >
                Category
              </label>
              <select
                id={`cat-${txn.id}`}
                name="categoryId"
                defaultValue={txn.categoryId ?? ""}
                className="field"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <label className="flex items-center gap-2 pb-2 text-sm">
              <input type="checkbox" name="learn" defaultChecked />
              <span>
                Remember for {txn.merchant ?? "this merchant"}
              </span>
            </label>

            <button type="submit" className="btn btn-primary mb-0.5">
              Save
            </button>
          </form>

          {/*
            A split replaces this row with siblings that sum to it, so the
            control is offered per transaction rather than as a bulk action.
          */}
          {txn.splitGroupId ? (
            <form action={unsplitTransactionAction} className="mt-3">
              <input type="hidden" name="groupId" value={txn.splitGroupId} />
              <p className="text-xs text-[var(--color-ink-muted)]">
                Part of a split
                {txn.splitOriginalCents
                  ? ` of ${formatCents(txn.splitOriginalCents)}`
                  : ""}
                .
              </p>
              <button
                type="submit"
                className="mt-1 text-xs text-[var(--color-accent)] underline underline-offset-4"
              >
                Undo the split
              </button>
            </form>
          ) : (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-[var(--color-ink-faint)] underline underline-offset-4 hover:text-[var(--color-ink)]">
                Split across categories
              </summary>
              <SplitForm
                transactionId={txn.id}
                amountCents={txn.amountCents}
                categoryId={txn.categoryId}
                categories={categories}
                suggestion={splitSuggestion}
              />
            </details>
          )}

          <form action={deleteTransactionAction} className="mt-3">
            <input type="hidden" name="transactionId" value={txn.id} />
            <button
              type="submit"
              className="text-xs text-[var(--color-ink-faint)] underline underline-offset-4 hover:text-[var(--color-negative)]"
            >
              Delete this transaction
            </button>
          </form>
        </div>
      ) : null}
    </li>
  );
}
