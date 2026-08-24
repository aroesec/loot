import type { ReactNode } from "react";
import { formatCents } from "@/lib/money";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-3xl leading-tight">{title}</h1>
        {subtitle ? (
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{subtitle}</p>
        ) : null}
      </div>
      {actions ? <div className="flex gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`card p-5 ${className}`}>{children}</div>;
}

/**
 * A headline figure. The label sits above so a row of these scans as a
 * sentence rather than a dashboard of disconnected numbers.
 */
export function Stat({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail?: ReactNode;
  tone?: "neutral" | "positive" | "negative" | "warning";
}) {
  const toneClass =
    tone === "positive"
      ? "text-positive"
      : tone === "negative"
        ? "text-negative"
        : tone === "warning"
          ? "text-warning"
          : "";

  return (
    <Card>
      <div className="text-xs uppercase tracking-wide text-[var(--color-ink-faint)]">
        {label}
      </div>
      <div className={`figure mt-2 text-2xl ${toneClass}`}>{value}</div>
      {detail ? (
        <div className="mt-1.5 text-xs text-[var(--color-ink-muted)]">{detail}</div>
      ) : null}
    </Card>
  );
}

export function Money({
  cents,
  signed = false,
  className = "",
  tone = "auto",
}: {
  cents: number;
  signed?: boolean;
  className?: string;
  tone?: "auto" | "none";
}) {
  const toneClass =
    tone === "none" ? "" : cents > 0 ? "text-positive" : cents < 0 ? "text-negative" : "";
  return (
    <span className={`figure ${toneClass} ${className}`}>
      {formatCents(cents, { signed })}
    </span>
  );
}

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <Card className="text-center">
      <p className="display text-xl">{title}</p>
      {children ? (
        <div className="mx-auto mt-2 max-w-md text-sm text-[var(--color-ink-muted)]">
          {children}
        </div>
      ) : null}
    </Card>
  );
}

/** Horizontal proportion bar used by budgets and category breakdowns. */
export function Bar({
  fraction,
  color,
  over = false,
}: {
  fraction: number;
  color?: string | null;
  over?: boolean;
}) {
  const pct = Math.max(0, Math.min(1, fraction)) * 100;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-bg-subtle)]">
      <div
        className="h-full rounded-full transition-[width]"
        style={{
          width: `${pct}%`,
          background: over
            ? "var(--color-negative)"
            : (color ?? "var(--color-accent)"),
        }}
      />
    </div>
  );
}
