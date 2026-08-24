"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatCents } from "@/lib/money";
import { suggestFor, type MerchantUse, type PopularUse } from "@/lib/review-suggest";
import type { CategoryOption, QueueItem } from "@/lib/review-queue";

/**
 * Answering the queue without touching the mouse.
 *
 * The queue is worth clearing only if clearing it is fast. A dropdown per row
 * is perfectly usable for three rows and abandoned at thirty, which is how a
 * ledger ends up with a permanent backlog of uncertain categories quietly
 * skewing every total.
 *
 * So: one transaction at a time, the likely answers on the number keys, and no
 * navigation between them — answering advances in place.
 */

type Props = {
  items: QueueItem[];
  categories: CategoryOption[];
  merchantHistory: Record<string, MerchantUse[]>;
  popular: PopularUse[];
  onAnswer: (input: {
    transactionId: string;
    categoryId: string;
    learn: boolean;
  }) => Promise<{ ok: boolean; categoryName?: string; learned?: boolean }>;
};

type Answered = { id: string; categoryName: string; learned: boolean };

export function ReviewQueue({
  items,
  categories,
  merchantHistory,
  popular,
  onAnswer,
}: Props) {
  const [index, setIndex] = useState(0);
  const [answered, setAnswered] = useState<Map<string, Answered>>(new Map());
  const [busy, setBusy] = useState(false);
  const [learn, setLearn] = useState(true);
  const [search, setSearch] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const remaining = items.filter((i) => !answered.has(i.id));
  const item = items[index];

  const suggestions = useMemo(() => {
    if (!item) return [];
    return suggestFor({
      amountCents: item.amountCents,
      merchant: item.merchant,
      current:
        item.categoryId && item.categoryName
          ? { id: item.categoryId, name: item.categoryName }
          : null,
      merchantHistory: item.merchant ? (merchantHistory[item.merchant] ?? []) : [],
      popular,
    });
  }, [item, merchantHistory, popular]);

  /** Advance past anything already answered, so the list never repeats itself. */
  const advance = useCallback(
    (from: number, direction: 1 | -1, done: Map<string, Answered>) => {
      let next = from + direction;
      while (next >= 0 && next < items.length && done.has(items[next]!.id)) {
        next += direction;
      }
      if (next < 0) return 0;
      if (next >= items.length) return items.length;
      return next;
    },
    [items],
  );

  const answer = useCallback(
    async (categoryId: string) => {
      if (!item || busy) return;
      setBusy(true);
      setError(null);

      const result = await onAnswer({
        transactionId: item.id,
        categoryId,
        learn,
      });

      if (!result.ok) {
        setError("That did not save. The transaction may have been removed.");
        setBusy(false);
        return;
      }

      const next = new Map(answered);
      next.set(item.id, {
        id: item.id,
        categoryName: result.categoryName ?? "",
        learned: Boolean(result.learned),
      });
      setAnswered(next);
      setIndex((i) => advance(i, 1, next));
      setSearch(null);
      setBusy(false);
    },
    [item, busy, onAnswer, learn, answered, advance],
  );

  const matches = useMemo(() => {
    if (search === null) return [];
    const q = search.trim().toLowerCase();
    const pool = q
      ? categories.filter((c) => c.name.toLowerCase().includes(q))
      : categories;
    return pool.slice(0, 9);
  }, [search, categories]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // Never steal a keystroke from a field the user is typing in.
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;

      if (typing) {
        if (event.key === "Escape") {
          setSearch(null);
          searchRef.current?.blur();
        }
        if (event.key >= "1" && event.key <= "9" && search !== null) {
          const pick = matches[Number(event.key) - 1];
          if (pick) {
            event.preventDefault();
            void answer(pick.id);
          }
        }
        return;
      }

      if (event.key >= "1" && event.key <= "9") {
        const pick = suggestions[Number(event.key) - 1];
        if (pick) {
          event.preventDefault();
          void answer(pick.categoryId);
        }
        return;
      }

      switch (event.key) {
        case "j":
        case "ArrowDown":
          event.preventDefault();
          setIndex((i) => advance(i, 1, answered));
          break;
        case "k":
        case "ArrowUp":
          event.preventDefault();
          setIndex((i) => advance(i, -1, answered));
          break;
        case "s":
          event.preventDefault();
          setIndex((i) => advance(i, 1, answered));
          break;
        case "l":
          event.preventDefault();
          setLearn((v) => !v);
          break;
        case "/":
          event.preventDefault();
          setSearch("");
          // Focus after the input exists.
          setTimeout(() => searchRef.current?.focus(), 0);
          break;
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [suggestions, matches, search, answer, advance, answered]);

  if (items.length === 0) {
    return (
      <p className="text-sm text-[var(--color-ink-muted)]">
        Nothing is waiting on an answer.
      </p>
    );
  }

  if (!item || remaining.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-sm">
          Answered {answered.size} of {items.length}.
        </p>
        <p className="text-sm text-[var(--color-ink-muted)]">
          {remaining.length === 0
            ? "The queue is clear."
            : `${remaining.length} left — press k to go back.`}
        </p>
      </div>
    );
  }

  const previous = answered.get(items[index - 1]?.id ?? "");

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-4 text-sm text-[var(--color-ink-muted)]">
        <span>
          {answered.size} answered · {remaining.length} left
        </span>
        <span className="figure text-xs">
          {index + 1} of {items.length}
        </span>
      </div>

      <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <div className="flex items-baseline justify-between gap-4">
          <div className="min-w-0">
            <p className="truncate text-lg">{item.merchant ?? item.rawDescription}</p>
            <p className="figure mt-0.5 text-xs text-[var(--color-ink-faint)]">
              {item.postedOn}
            </p>
          </div>
          <p
            className={`figure shrink-0 text-lg ${
              item.amountCents > 0
                ? "text-[var(--color-positive)]"
                : "text-[var(--color-ink)]"
            }`}
          >
            {formatCents(item.amountCents)}
          </p>
        </div>

        {item.merchant && item.merchant !== item.rawDescription ? (
          <p className="mt-2 truncate font-mono text-xs text-[var(--color-ink-faint)]">
            {item.rawDescription}
          </p>
        ) : null}

        {/*
          Why this row is being asked about. A queued payment rail and a
          low-confidence guess look identical without it, and they call for
          different answers: one is "what was this for", the other "is this
          right".
        */}
        {item.reason ? (
          <p className="mt-3 text-sm text-[var(--color-ink-muted)]">
            {item.queued ? "Queued: " : "Uncertain: "}
            {item.reason}
          </p>
        ) : null}

        {search === null ? (
          <ul className="mt-4 space-y-1.5">
            {suggestions.map((s, i) => (
              <li key={s.categoryId}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void answer(s.categoryId)}
                  className="flex w-full items-baseline gap-3 rounded-[var(--radius-md)] px-2 py-1.5 text-left hover:bg-[var(--color-bg-subtle)] disabled:opacity-50"
                >
                  <kbd className="figure w-5 shrink-0 rounded border border-[var(--color-border)] text-center text-xs text-[var(--color-ink-muted)]">
                    {i + 1}
                  </kbd>
                  <span className="min-w-0 flex-1 truncate text-sm">{s.name}</span>
                  <span className="shrink-0 text-xs text-[var(--color-ink-faint)]">
                    {s.why}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-4">
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search every category…"
              className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm"
            />
            <ul className="mt-2 space-y-1">
              {matches.map((c, i) => (
                <li key={c.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void answer(c.id)}
                    className="flex w-full items-baseline gap-3 rounded-[var(--radius-md)] px-2 py-1.5 text-left hover:bg-[var(--color-bg-subtle)] disabled:opacity-50"
                  >
                    <kbd className="figure w-5 shrink-0 rounded border border-[var(--color-border)] text-center text-xs text-[var(--color-ink-muted)]">
                      {i + 1}
                    </kbd>
                    <span className="truncate text-sm">{c.name}</span>
                  </button>
                </li>
              ))}
              {matches.length === 0 ? (
                <li className="px-2 py-1.5 text-sm text-[var(--color-ink-faint)]">
                  No category matches that.
                </li>
              ) : null}
            </ul>
          </div>
        )}

        {error ? (
          <p className="mt-3 text-sm text-[var(--color-negative)]">{error}</p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--color-ink-muted)]">
        <span className="flex flex-wrap gap-x-3 gap-y-1">
          <Key label="1–9" hint="choose" />
          <Key label="/" hint="all categories" />
          <Key label="j / k" hint="next / back" />
          <Key label="s" hint="skip" />
          <Key label="l" hint="rule on/off" />
        </span>
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={learn}
            onChange={(e) => setLearn(e.target.checked)}
          />
          {/*
            On by default: teaching the rule is most of the value, since it also
            re-files matching history. Worth being able to turn off for a
            one-off — a $6,000 Zelle for contract work should not make every future
            Zelle home maintenance.
          */}
          <span>Also write a rule and re-file matching history</span>
        </label>
      </div>

      {previous ? (
        <p className="text-xs text-[var(--color-ink-faint)]">
          Last: filed as {previous.categoryName}
          {previous.learned ? ", rule written" : ""}. Press k to change it.
        </p>
      ) : null}
    </div>
  );
}

function Key({ label, hint }: { label: string; hint: string }) {
  return (
    <span className="whitespace-nowrap">
      <kbd className="figure rounded border border-[var(--color-border)] px-1">
        {label}
      </kbd>{" "}
      {hint}
    </span>
  );
}
