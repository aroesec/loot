import { db } from "@/db";
import { settings } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  isSafeThemeValue,
  safeThemeValue,
  themeToCss as renderThemeCss,
} from "./theme-css";

export { isSafeThemeValue, safeThemeValue } from "./theme-css";

/**
 * The theme is a flat set of CSS custom properties stored as JSON. Every
 * surface in the app reads from these variables and nothing hardcodes a color,
 * so changing a token here restyles the whole app — including the parts that
 * did not exist when the token was set.
 *
 * The defaults are a warm-paper and deep-jade palette: quiet, high-contrast,
 * and deliberately not the blue-on-white look every finance app defaults to.
 */

export type ThemeTokens = Record<string, string>;

export const THEME_DEFAULTS: ThemeTokens = {
  // --- Light -------------------------------------------------------------
  "bg": "#FBFAF7",
  "bg-subtle": "#F3F1EA",
  "surface": "#FFFFFF",
  "surface-raised": "#FFFFFF",
  "border": "#E5E1D8",
  "border-strong": "#D2CCBF",
  "ink": "#16150F",
  "ink-muted": "#6B675E",
  "ink-faint": "#969188",
  "accent": "#1A6B52",
  "accent-ink": "#FFFFFF",
  "accent-soft": "#E4F0EA",
  "positive": "#1A6B52",
  "negative": "#A6402F",
  "negative-soft": "#F7E8E4",
  "warning": "#A9761F",
  "warning-soft": "#F8EEDC",

  // --- Dark --------------------------------------------------------------
  "dark-bg": "#100F0C",
  "dark-bg-subtle": "#181712",
  "dark-surface": "#1A1914",
  "dark-surface-raised": "#22201A",
  "dark-border": "#2E2C24",
  "dark-border-strong": "#413E33",
  "dark-ink": "#F4F1E8",
  "dark-ink-muted": "#A8A395",
  "dark-ink-faint": "#78736A",
  "dark-accent": "#4FBF97",
  "dark-accent-ink": "#0C1A14",
  "dark-accent-soft": "#17332A",
  "dark-positive": "#4FBF97",
  "dark-negative": "#E08A72",
  "dark-negative-soft": "#33201B",
  "dark-warning": "#D9A94F",
  "dark-warning-soft": "#33291533",

  // --- Shape -------------------------------------------------------------
  "radius": "10px",
  "radius-lg": "16px",
  "density": "1",
  "font-display": "var(--font-display)",
  "font-sans": "var(--font-sans)",
  "font-mono": "var(--font-mono)",
};

/** Tokens surfaced in the settings UI, grouped for editing. */
export const EDITABLE_TOKENS: Array<{
  group: string;
  tokens: Array<{ key: string; label: string; type: "color" | "text" }>;
}> = [
  {
    group: "Light mode",
    tokens: [
      { key: "bg", label: "Page background", type: "color" },
      { key: "surface", label: "Card surface", type: "color" },
      { key: "border", label: "Borders", type: "color" },
      { key: "ink", label: "Text", type: "color" },
      { key: "ink-muted", label: "Muted text", type: "color" },
      { key: "accent", label: "Accent", type: "color" },
      { key: "positive", label: "Income", type: "color" },
      { key: "negative", label: "Spending", type: "color" },
      { key: "warning", label: "Warning", type: "color" },
    ],
  },
  {
    group: "Dark mode",
    tokens: [
      { key: "dark-bg", label: "Page background", type: "color" },
      { key: "dark-surface", label: "Card surface", type: "color" },
      { key: "dark-border", label: "Borders", type: "color" },
      { key: "dark-ink", label: "Text", type: "color" },
      { key: "dark-ink-muted", label: "Muted text", type: "color" },
      { key: "dark-accent", label: "Accent", type: "color" },
      { key: "dark-positive", label: "Income", type: "color" },
      { key: "dark-negative", label: "Spending", type: "color" },
      { key: "dark-warning", label: "Warning", type: "color" },
    ],
  },
  {
    group: "Shape",
    tokens: [
      { key: "radius", label: "Corner radius", type: "text" },
      { key: "radius-lg", label: "Large radius", type: "text" },
      { key: "density", label: "Spacing scale", type: "text" },
    ],
  },
];

/** A few complete looks, so customizing doesn't have to start from scratch. */
export const THEME_PRESETS: Array<{
  id: string;
  name: string;
  description: string;
  tokens: ThemeTokens;
}> = [
  {
    id: "paper",
    name: "Paper & Jade",
    description: "Warm off-white with a deep green accent. The default.",
    tokens: {},
  },
  {
    id: "slate",
    name: "Slate",
    description: "Cool neutral greys with a muted blue accent.",
    tokens: {
      bg: "#F7F8FA",
      "bg-subtle": "#EEF0F4",
      surface: "#FFFFFF",
      border: "#DFE3EA",
      ink: "#111418",
      "ink-muted": "#5D6673",
      accent: "#2E5B8C",
      "accent-soft": "#E5EDF6",
      positive: "#2F7A5B",
      negative: "#B04437",
      "dark-bg": "#0C0E11",
      "dark-surface": "#14181D",
      "dark-border": "#242A32",
      "dark-accent": "#6FA8DC",
    },
  },
  {
    id: "ink",
    name: "Ink & Amber",
    description: "Near-black with a warm amber accent. High contrast.",
    tokens: {
      bg: "#FAF9F6",
      "bg-subtle": "#F0EEE8",
      surface: "#FFFFFF",
      border: "#E2DFD6",
      ink: "#0D0C0A",
      "ink-muted": "#605C54",
      accent: "#B0741C",
      "accent-soft": "#F8EEDA",
      positive: "#3F7A4A",
      negative: "#A33B2C",
      "dark-bg": "#0A0908",
      "dark-surface": "#151310",
      "dark-border": "#2A2620",
      "dark-accent": "#E0A951",
    },
  },
  {
    id: "plum",
    name: "Plum",
    description: "Soft rose-grey with a deep plum accent.",
    tokens: {
      bg: "#FBF9FA",
      "bg-subtle": "#F3EFF1",
      surface: "#FFFFFF",
      border: "#E7E0E4",
      ink: "#171316",
      "ink-muted": "#6B6167",
      accent: "#6B3A5C",
      "accent-soft": "#F2E8EF",
      positive: "#3B6E58",
      negative: "#A63F4A",
      "dark-bg": "#100D0F",
      "dark-surface": "#191518",
      "dark-border": "#2D262B",
      "dark-accent": "#C48BB2",
    },
  },
];

/**
 * One token's concrete value.
 *
 * `ThemeTokens` is an open record, so indexing it types as `string | undefined`
 * even for keys that always exist — and most consumers are CSS, where that
 * never comes up because they read `var(--color-*)` instead. The exceptions are
 * the places a real string has to be produced: the manifest's `theme_color`,
 * the browser chrome color, and the rendered app icon.
 *
 * `loadTheme` spreads the defaults first, so a stored theme missing a key still
 * resolves. The last fallback is only reachable through a key that is not in
 * the defaults at all, which is a typo rather than a configuration — a wrong
 * grey beats throwing out of a root layout for a chrome color.
 */
export function themeToken(tokens: ThemeTokens, key: string): string {
  // Sanitised for the same reason `themeToCss` is: this value reaches the web
  // manifest and is interpolated into the generated SVG icon, both of which are
  // markup a raw value could break out of.
  return safeThemeValue(tokens[key], THEME_DEFAULTS[key] ?? "#808080");
}

export async function loadTheme(): Promise<ThemeTokens> {
  try {
    const rows = await db
      .select({ theme: settings.theme })
      .from(settings)
      .where(eq(settings.id, "singleton"))
      .limit(1);
    return { ...THEME_DEFAULTS, ...(rows[0]?.theme ?? {}) };
  } catch {
    // A missing settings row (or an unmigrated DB) must not stop the app from
    // rendering — fall back to the defaults.
    return THEME_DEFAULTS;
  }
}

export async function saveTheme(tokens: ThemeTokens): Promise<void> {
  // Only persist what differs from the defaults, so future default changes
  // still reach anyone who hasn't overridden that token.
  const overrides: ThemeTokens = {};
  for (const [key, value] of Object.entries(tokens)) {
    if (value && value !== THEME_DEFAULTS[key]) overrides[key] = value;
  }

  await db
    .insert(settings)
    .values({ id: "singleton", theme: overrides, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: settings.id,
      set: { theme: overrides, updatedAt: new Date() },
    });
}

/** Render the token map as a CSS block for the document head. */
export function themeToCss(tokens: ThemeTokens): string {
  return renderThemeCss(tokens, THEME_DEFAULTS);
}
