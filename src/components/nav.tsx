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

  return (
    <nav className="shrink-0 border-b border-[var(--color-border)] px-5 py-4 lg:w-56 lg:border-b-0 lg:border-r lg:px-6 lg:py-8">
      <Link href="/" className="mb-6 hidden items-baseline gap-1.5 lg:flex">
        <span className="display text-2xl">Loot</span>
      </Link>

      <ul className="scroll-x flex gap-1 lg:flex-col lg:gap-0.5">
        <li className="lg:hidden">
          <span className="display mr-3 text-xl">Loot</span>
        </li>
        {links.map((link) => {
          const active =
            link.href === "/"
              ? pathname === "/"
              : pathname.startsWith(link.href);
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`block whitespace-nowrap rounded-[var(--radius-token)] px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? "bg-[var(--color-accent-soft)] font-medium text-[var(--color-accent)]"
                    : "text-[var(--color-ink-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-ink)]"
                }`}
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
