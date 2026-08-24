import type { Metadata, Viewport } from "next";
import { Instrument_Serif } from "next/font/google";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { loadTheme, themeToCss, themeToken } from "@/lib/theme";
import { isAuthenticated } from "@/lib/auth";
import { Nav } from "@/components/nav";
import { DataHealth } from "@/components/data-health";
import { ledgerMode } from "@/lib/mode";
import { ThemeToggle } from "@/components/theme-toggle";
import "./globals.css";

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Loot",
  description: "A personal ledger that reads your statements and tallies the year.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.png", sizes: "32x32", type: "image/png" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    // iOS ignores the manifest's icons for Add to Home Screen and reads this.
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    /*
     * Without this, tapping the Home Screen icon on iOS opens Safari with an
     * address bar and, more importantly, **no push**: Safari only grants
     * notification permission to a site running as an installed web app.
     */
    capable: true,
    title: "Loot",
    // `default` keeps content below the status bar. The translucent styles
    // require handling safe-area insets, which this layout does not do.
    statusBarStyle: "default",
  },
  // A ledger has nothing to gain from being indexed, and something to lose.
  robots: { index: false, follow: false },
};

/**
 * Browser chrome color, per scheme.
 *
 * Read from the theme rather than fixed, so the status bar of an installed app
 * matches the page it frames instead of whichever green shipped in the repo.
 */
export async function generateViewport(): Promise<Viewport> {
  const theme = await loadTheme();
  return {
    themeColor: [
      { media: "(prefers-color-scheme: light)", color: themeToken(theme, "bg") },
      { media: "(prefers-color-scheme: dark)", color: themeToken(theme, "dark-bg") },
    ],
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [theme, authed, mode] = await Promise.all([
    loadTheme(),
    isAuthenticated(),
    ledgerMode(),
  ]);

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable} ${instrumentSerif.variable}`}
    >
      <head>
        {/*
          Next emits the standardized `mobile-web-app-capable`, which iOS 16.4+
          honours via the manifest's `display` anyway. This is the older
          Apple-prefixed spelling, kept because it is the only one earlier iOS
          reads and a deployment cannot choose its visitors' Safari version.
        */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        {/* Theme tokens come from the database, so they're inlined per request. */}
        <style
          id="theme-tokens"
          dangerouslySetInnerHTML={{ __html: themeToCss(theme) }}
        />
        {/*
          Applies the stored light/dark preference before first paint. Without
          this the page flashes light before hydration on a dark-mode load.

          Also marks the document as scripted, which lets controls that submit
          themselves hide their no-script fallback without it flashing first.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("loot-mode")||localStorage.getItem("moneybags-mode");if(!t){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}document.documentElement.setAttribute("data-theme",t);}catch(e){}document.documentElement.classList.add("js");})();`,
          }}
        />
      </head>
      <body className="min-h-screen">
        {authed ? (
          <div className="mx-auto flex min-h-screen w-full max-w-[1400px] flex-col lg:flex-row">
            <Nav mode={mode} />
            <div className="flex min-w-0 flex-1 flex-col">
              <header className="flex items-center justify-end px-5 pt-5 lg:px-8">
                <ThemeToggle />
              </header>
              <main className="min-w-0 flex-1 px-5 pb-16 pt-4 lg:px-8">
                {/*
                  Above the page, on every page. Both problems it covers are
                  invisible by construction: a misclassified row looks ordinary
                  in a total, and a missing household size makes every benchmark
                  wrong without anything appearing broken.
                */}
                <DataHealth />
                {children}
              </main>
            </div>
          </div>
        ) : (
          <main className="min-h-screen">{children}</main>
        )}
      </body>
    </html>
  );
}
