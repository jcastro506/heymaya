import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
});

/**
 * Default site metadata. Per-page metadata (e.g. `app/page.tsx`,
 * `app/creators/page.tsx`) overrides this for the routes that have their
 * own. The default is flag-aware so unconfigured routes (sign-in, sign-up,
 * any future page that inherits) reflect whichever product is publicly
 * exposed — see `NEXT_PUBLIC_ENABLE_CREATOR_PRODUCT` in `middleware.ts`.
 */
const CREATOR_PRODUCT_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_CREATOR_PRODUCT === "true";

export const metadata: Metadata = CREATOR_PRODUCT_ENABLED
  ? {
      title: "HeyMaya — Your AI creator manager. Hire her in 4 minutes.",
      description:
        "Maya plans your week, watches your performance, triages your brand emails, and tells you what to post next — every day, in your messages.",
    }
  : {
      title:
        "HeyMaya — your AI marketing manager before you can afford a human one.",
      description:
        "Maya turns every completed job into local marketing. GBP posts, review requests, brand-voice replies — drafted and queued for one-tap approval.",
    };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-[var(--ink)] text-[var(--paper)]">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
