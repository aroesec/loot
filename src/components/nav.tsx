"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * `mode` is the ledger type. Business-only destinations are hidden rather than
 * shown-and-empty: a P&L link on a personal ledger leads to a page that can
 * only explain why it has nothing to show, and Budgets is a household idea
 * that a P&L already answers better.
 */
const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/transactions", label: "Transactions" },
  { href: "/upload", label: "Import" },
  { href: "/goals", label: "Buffer & goals" },
  { href: "/cards", label: "Card payments" },
  { href: "/pl", label: "Profit & Loss", mode: "business" },
  { href: "/schedule-c", label: "Schedule C", mode: "business" },
  { href: "/mileage", label: "Mileage", mode: "business" },
  { href: "/budgets", label: "Budgets", mode: "personal" },
  { href: "/recurring", label: "Recurring" },
  { href: "/review", label: "Review" },
  { href: "/year", label: "Year" },
  { href: "/insights", label: "Insights" },
  { href: "/settings", label: "Settings" },
] as const;

export function Nav({ mode = "personal" }: { mode?: "personal" | "business" }) {
  const pathname = usePathname();
  const links = LINKS.filter((l) => !("mode" in l) || l.mode === mode);

  const items = links.map((link) => {
    const active =
      link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
    return (
      <li key={link.href}>
        <Link
          href={link.href}
          aria-current={active ? "page" : undefined}
          className={`flex min-h-11 items-center rounded-[var(--radius-token)] px-3 py-2 text-sm transition-colors ${active ? "bg-[var(--color-accent-soft)] font-medium text-[var(--color-accent)]" : "text-[var(--color-ink-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-ink)]"}`}
        >
          {link.label}
        </Link>
      </li>
    );
  });
  return (
    <nav
      aria-label="Main navigation"
      className="min-w-0 shrink-0 border-b border-[var(--color-border)] px-4 py-3 sm:px-5 lg:w-56 lg:border-b-0 lg:border-r lg:px-6 lg:py-8"
    >
      <div className="flex items-center justify-between gap-4 lg:hidden">
        <Link href="/" className="display flex min-h-11 items-center text-2xl">
          Loot
        </Link>
        <span className="truncate text-sm text-[var(--color-ink-muted)]">
          {
            links.find((link) =>
              link.href === "/"
                ? pathname === "/"
                : pathname.startsWith(link.href),
            )?.label
          }
        </span>
      </div>
      <details
        className="mt-1 lg:hidden"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.currentTarget.open = false;
            event.currentTarget.querySelector("summary")?.focus();
          }
        }}
      >
        <summary className="cursor-pointer rounded-[var(--radius-token)] border border-[var(--color-border)] px-3 py-3 text-sm font-medium">
          Menu · All pages
        </summary>
        <ul
          className="mt-2 grid grid-cols-2 gap-1"
          onClick={(event) => {
            if (event.target instanceof Element && event.target.closest("a"))
              event.currentTarget.closest("details")?.removeAttribute("open");
          }}
        >
          {items}
        </ul>
      </details>
      <div className="hidden lg:block">
        <Link href="/" className="display mb-6 flex items-baseline text-2xl">
          Loot
        </Link>
        <ul className="flex flex-col gap-0.5">{items}</ul>
      </div>
    </nav>
  );
}
