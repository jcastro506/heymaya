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
  // No "AI" in marketing copy, per the standing voice rule.
  title: "HeyMaya, the marketing hire for builders Cursor unlocked.",
  description:
    "Maya finds the people already looking for what you built, posts from your accounts without getting them banned, and shows you which post got the signup.",
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
