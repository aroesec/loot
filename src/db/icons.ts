import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { iconColors, iconSvg } from "@/lib/icon";

/**
 * `pnpm icons` — render the app icon at every size a platform asks for.
 *
 * Committed rather than generated at build time: they change only when the
 * theme does, and a build step that shells out to sharp is a thing to go wrong
 * on someone else's deployment for no benefit.
 *
 * Run this after changing the accent color if you want the Home Screen icon to
 * follow it.
 */

/**
 * Live theme first, defaults if there is no database to read.
 *
 * Someone cloning the repo should be able to produce icons before they have
 * provisioned Postgres, so a connection failure falls back rather than aborts.
 */
async function colors() {
  try {
    const { loadTheme } = await import("@/lib/theme");
    return iconColors(await loadTheme());
  } catch {
    console.log("  (no database — using the default theme)");
    return iconColors();
  }
}

const OUT = "public";

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const palette = await colors();

  const png = (svg: string, size: number, name: string) =>
    sharp(Buffer.from(svg))
      .resize(size, size)
      .png({ compressionLevel: 9 })
      .toFile(join(OUT, name))
      .then(() => console.log(`  ${name}`));

  // Vector source of truth, so the icon stays crisp wherever SVG is accepted.
  const source = iconSvg(512, palette);
  writeFileSync(join(OUT, "icon.svg"), source);
  console.log("  icon.svg");

  await Promise.all([
    png(source, 192, "icon-192.png"),
    png(source, 512, "icon-512.png"),

    /*
     * `sw.js` shows this on every notification, and it referenced a file that
     * was never generated — so every alert so far has rendered with the
     * browser's default icon instead.
     */
    png(source, 192, "icon.png"),

    /*
     * iOS ignores the manifest's icons for Add to Home Screen and uses this
     * one, at 180px, with no transparency and its own corner mask applied.
     */
    png(iconSvg(512, palette, { rounded: false }), 180, "apple-touch-icon.png"),

    /*
     * Maskable: the platform crops this to a shape of its choosing, so the mark
     * is inset far enough that a circular crop cannot clip it.
     */
    png(iconSvg(512, palette, { safeArea: 0.22, rounded: false }), 512, "icon-maskable-512.png"),

    png(source, 32, "favicon.png"),
  ]);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("icon generation failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
