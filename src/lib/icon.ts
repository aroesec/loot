import { themeToken, type ThemeTokens } from "./theme";

/**
 * The app icon, drawn from theme tokens rather than shipped as a fixed image.
 *
 * Nothing in this codebase hardcodes a color, and an icon is not an exception
 * just because it ends up as a PNG. A fork that changes the accent should get
 * its own icon out of `pnpm icons` rather than inheriting someone else's green.
 *
 * The mark is four ascending bars: legible at 32px where anything with detail
 * turns to mush, and unmistakably about money going up and down rather than
 * generic enough to be any app at all.
 */

export type IconColors = { background: string; foreground: string; muted: string };

export function iconColors(tokens: ThemeTokens = {}): IconColors {
  return {
    background: themeToken(tokens, "accent"),
    foreground: themeToken(tokens, "accent-ink"),
    // The dip in the middle: softer ink, so the shape still reads at 32px.
    muted: themeToken(tokens, "accent-soft"),
  };
}

/**
 * @param safeArea Fraction of the canvas the mark is inset by.
 *
 *   A maskable icon is cropped to whatever shape the platform likes — Android
 *   may take a circle out of the middle — and only the central 80% is
 *   guaranteed to survive. A normal icon uses the full canvas, so the two are
 *   the same drawing at two insets rather than two files to keep in sync.
 */
export function iconSvg(
  size: number,
  colors: IconColors,
  opts: { safeArea?: number; rounded?: boolean } = {},
): string {
  const { safeArea = 0.12, rounded = true } = opts;

  const inset = size * safeArea;
  const inner = size - inset * 2;

  // Four bars, ascending, with a dip so it reads as a ledger rather than a
  // volume meter. Heights are fractions of the drawable area.
  const heights = [0.42, 0.68, 0.5, 1];
  const gap = inner * 0.08;
  const barWidth = (inner - gap * (heights.length - 1)) / heights.length;
  const radius = barWidth * 0.28;

  const bars = heights
    .map((h, i) => {
      const barHeight = inner * h;
      const x = inset + i * (barWidth + gap);
      const y = inset + inner - barHeight;
      // The dip is softened rather than a different hue, so it survives being
      // rendered in monochrome by a notification badge.
      const fill = h === 0.5 ? colors.muted : colors.foreground;
      return `<rect x="${r(x)}" y="${r(y)}" width="${r(barWidth)}" height="${r(barHeight)}" rx="${r(radius)}" fill="${fill}"/>`;
    })
    .join("");

  /*
   * The background is a full-bleed square with rounded corners. iOS applies its
   * own mask on top, so transparency here would show as a black square on a
   * Home Screen — every platform is happier with an opaque backdrop.
   */
  const backdrop = rounded
    ? `<rect width="${size}" height="${size}" rx="${r(size * 0.22)}" fill="${colors.background}"/>`
    : `<rect width="${size}" height="${size}" fill="${colors.background}"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${backdrop}${bars}</svg>`;
}

function r(n: number): string {
  return String(Math.round(n * 100) / 100);
}
