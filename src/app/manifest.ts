import type { MetadataRoute } from "next";
import { loadTheme, themeToken } from "@/lib/theme";

/**
 * The web app manifest.
 *
 * This is what makes the app installable, and on iOS installation is not a
 * nicety — Safari refuses `Notification.requestPermission()` entirely until the
 * site has been added to the Home Screen, so without this file the alerts this
 * app computes have nowhere to go on the most likely device to want them.
 *
 * Generated per request rather than committed as JSON so the colors follow the
 * deployment's theme, the same way every other surface does.
 */
export const dynamic = "force-dynamic";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const theme = await loadTheme();

  return {
    id: "/",
    name: "Loot",
    short_name: "Loot",
    description:
      "A personal ledger that reads your statements and tallies the year.",
    start_url: "/",
    scope: "/",
    /*
     * `standalone` rather than `browser`: on iOS this is the difference between
     * push working and not, and it also drops the address bar, which is worth
     * something on a page that is mostly a table of numbers.
     */
    display: "standalone",
    background_color: themeToken(theme, "bg"),
    theme_color: themeToken(theme, "bg"),
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      /*
       * Declared separately from the plain icons. A maskable icon is cropped to
       * whatever shape the platform prefers, so listing the same file for both
       * purposes gets the mark clipped on Android — this one is drawn with the
       * inset that survives a circular crop.
       */
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    /*
     * Long-press shortcuts. Both are places you arrive at with something
     * specific to do, which is the bar for earning a slot here — a shortcut to
     * the dashboard would just be the app.
     */
    shortcuts: [
      {
        name: "Review queue",
        short_name: "Review",
        description: "Categorize the transactions waiting on an answer",
        url: "/review/queue",
      },
      {
        name: "Upload a statement",
        short_name: "Upload",
        description: "Import a CSV or PDF statement",
        url: "/upload",
      },
    ],
  };
}
