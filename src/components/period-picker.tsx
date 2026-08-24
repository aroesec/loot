"use client";

/**
 * A period selector that applies as soon as you change it.
 *
 * These were a `<select>` plus a separate "Go" button. That is a real form and
 * it worked, but only if you noticed the button — changing the dropdown and
 * seeing nothing happen reads as broken, which is exactly what it looked like
 * once the ledger had more than one month in it.
 *
 * The form is kept rather than replaced with a click handler, so the no-script
 * path still works: without JavaScript the submit button is the control, and
 * with it the button becomes redundant and is hidden.
 *
 * `carry` preserves the other query parameters. A native GET submission
 * replaces the whole query string, so without it switching the month on
 * `/pl?period=year` would silently drop back to the monthly view.
 */
export function PeriodPicker({
  name,
  value,
  options,
  label,
  carry = {},
}: {
  name: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  label: string;
  carry?: Record<string, string | undefined>;
}) {
  return (
    <form className="flex items-center gap-2">
      {Object.entries(carry).map(([k, v]) =>
        v === undefined || k === name ? null : (
          <input key={k} type="hidden" name={k} value={v} />
        ),
      )}

      <label htmlFor={name} className="sr-only">
        {label}
      </label>
      <select
        id={name}
        name={name}
        defaultValue={value}
        className="field !w-auto"
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {/*
        The fallback for a browser without JavaScript. Hidden by a root class
        the pre-paint script sets, so it never flashes in.
      */}
      <button type="submit" className="btn js-hidden">
        Go
      </button>
    </form>
  );
}
