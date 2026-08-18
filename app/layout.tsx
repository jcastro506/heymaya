import type { Metadata, Viewport } from "next";
import { Geist, Instrument_Serif } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});


const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
});

/**
 * Default site metadata. Per-page metadata (e.g. `app/page.tsx`) overrides
 * this. Sprint 0 collapsed a flag-aware ternary here: one branch described
 * the deleted creator product, the other the deleted trades product.
 */
export const metadata: Metadata = {
  /**
   * ⚠️ No "AI", per the standing voice rule and `tests/marketingCopy.test.ts`.
   *
   * Rewritten 2026-08-17 to match the page. It still described her as a
   * marketing hire that "finds people looking for what you built" — the old
   * positioning — while the landing page had moved to UGC. The tab title and
   * the link preview are the first words most people read, and they were
   * selling a different product.
   *
   * ⚠️ Names UGC without claiming she creates it: the guard bans a creation
   * verb within 40 characters of the word, because she has never rendered a
   * video.
   */
  title: "HeyMaya, the UGC your app needs.",
  description:
    "Maya watches what's working in your niche, creates your TikToks, Reels and Shorts, and posts them for you. You never film a thing.",
};

/**
 * Mobile-first viewport. `viewportFit: "cover"` lets us paint behind the
 * iPhone notch / Dynamic Island and Android edge-to-edge bars; pages then
 * use `env(safe-area-inset-*)` to keep tap targets out from under the
 * home-indicator. `themeColor` matches the dark-paper background so the
 * iOS status bar tints correctly. `userScalable: true` preserved on
 * purpose — never disable pinch-zoom for accessibility.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0B0C0E",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${instrumentSerif.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* iOS PWA + status-bar styling. Safari respects these tags
            independently of Next's `viewport` export. */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="format-detection" content="telephone=no" />
      </head>
      <body className="min-h-full flex flex-col bg-[var(--ink)] text-[var(--paper)]">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
