"use client";

import { useState } from "react";
import { STATE_PRICE_LEVEL } from "@/lib/benchmarks/regions";

// The states the benchmark data actually covers, so the picker cannot offer
// one that would silently fall back to the national average.
const STATES = Object.keys(STATE_PRICE_LEVEL).sort();

/**
 * The first-run questions.
 *
 * Two steps, and the second one differs entirely depending on the first. A
 * business does not have a household size and a household does not have a
 * business name, so asking both and hiding the irrelevant half would make the
 * form longer for everyone.
 */

type Mode = "personal" | "business";
type Household = { adults: number; children: number; country: string; region: string | null };

export function OnboardingFlow({
  initialMode,
  initialHousehold,
  onComplete,
}: {
  initialMode: Mode;
  initialHousehold: Household;
  onComplete: (formData: FormData) => Promise<void>;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [step, setStep] = useState<1 | 2>(1);

  return (
    <form action={onComplete} className="space-y-5">
      <input type="hidden" name="mode" value={mode} />

      {step === 1 ? (
        <>
          <fieldset>
            <legend className="text-sm text-[var(--color-ink-muted)]">
              What is this ledger for?
            </legend>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Choice
                selected={mode === "personal"}
                onSelect={() => setMode("personal")}
                title="Personal"
                blurb="A household. Answers what you spent, what you have left, and whether a month was normal."
                detail="Budgets, a cash buffer, comparisons with national averages."
              />
              <Choice
                selected={mode === "business"}
                onSelect={() => setMode("business")}
                title="Business"
                blurb="A business or side income. Answers what the profit is and what to hold back for tax."
                detail="Profit & loss, Schedule C lines, quarterly estimates, owner's draw kept out of expenses."
              />
            </div>
          </fieldset>

          {/*
            Worth saying now rather than at the point of regret. Switching is
            supported, but it does not re-file anything that has already been
            classified.
          */}
          <p className="text-xs text-[var(--color-ink-faint)]">
            You can change this later in Settings. Switching re-points the
            classifier and the reports, but it does not reclassify history you
            have already imported.
          </p>

          <button type="button" className="btn btn-primary" onClick={() => setStep(2)}>
            Continue
          </button>
        </>
      ) : (
        <>
          {mode === "personal" ? (
            <PersonalStep initial={initialHousehold} />
          ) : (
            <BusinessStep />
          )}

          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn btn-primary">
              Finish
            </button>
            <button type="button" className="btn" onClick={() => setStep(1)}>
              Back
            </button>
          </div>

          <p className="text-xs text-[var(--color-ink-faint)]">
            Everything on this step can be left blank and set later.
          </p>
        </>
      )}
    </form>
  );
}

function Choice({
  selected,
  onSelect,
  title,
  blurb,
  detail,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  blurb: string;
  detail: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`rounded-[var(--radius-lg)] border p-4 text-left transition ${
        selected
          ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
          : "border-[var(--color-border)] hover:bg-[var(--color-bg-subtle)]"
      }`}
    >
      <span className="block text-base">{title}</span>
      <span className="mt-1 block text-sm text-[var(--color-ink-muted)]">{blurb}</span>
      <span className="mt-2 block text-xs text-[var(--color-ink-faint)]">{detail}</span>
    </button>
  );
}

function PersonalStep({ initial }: { initial: Household }) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm text-[var(--color-ink-muted)]">
        Who does this cover?
      </legend>

      {/*
        Asked here because the cost of not knowing is silent: every comparison
        with published averages is scaled per person, so a family left at one
        adult is told it overspends on everything and nothing looks broken.
      */}
      <p className="text-xs text-[var(--color-ink-faint)]">
        Used to scale comparisons with published averages. Left at one person, a
        family is told it overspends on everything.
      </p>

      <div className="flex flex-wrap gap-3">
        <label className="text-sm">
          <span className="block text-xs text-[var(--color-ink-muted)]">Adults</span>
          <input
            type="number" name="adults" min={1} max={12} defaultValue={initial.adults}
            className="mt-1 w-20 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1"
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-[var(--color-ink-muted)]">Children</span>
          <input
            type="number" name="children" min={0} max={12} defaultValue={initial.children}
            className="mt-1 w-20 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1"
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-[var(--color-ink-muted)]">State</span>
          <select
            name="region" defaultValue={initial.region ?? ""}
            className="mt-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1"
          >
            <option value="">Not in the US</option>
            {STATES.map((code) => (
              <option key={code} value={code}>{code}</option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-xs text-[var(--color-ink-faint)]">
        State adjusts national averages for local prices, worth up to about 15%
        either way.
      </p>
    </fieldset>
  );
}

function BusinessStep() {
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm text-[var(--color-ink-muted)]">
        About the business
      </legend>

      <label className="block text-sm">
        <span className="block text-xs text-[var(--color-ink-muted)]">
          Business name
        </span>
        <input
          type="text" name="businessName" placeholder="Optional"
          className="mt-1 w-full max-w-sm rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1"
        />
      </label>

      <label className="block text-sm">
        <span className="block text-xs text-[var(--color-ink-muted)]">
          Income tax rate you expect to pay on profit
        </span>
        <input
          type="number" name="rate" min={0} max={60} defaultValue={22}
          className="mt-1 w-24 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1"
        />
      </label>

      {/*
        The distinction the whole tax page rests on, stated once at the start:
        one number is computed and the other is supplied.
      */}
      <p className="text-xs text-[var(--color-ink-faint)]">
        Self-employment tax is worked out from your profit. Income tax is not:
        it depends on your filing status, other income and the rest of your
        return, so this app uses the rate you give it. Both are shown separately
        on the Schedule C page, and neither is tax advice.
      </p>
    </fieldset>
  );
}
