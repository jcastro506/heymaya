/**
 * HeyMaya product waitlist — the primary CTA target when
 * NEXT_PUBLIC_HEYMAYA_LANDING_MODE=waitlist.
 *
 * Matches the cream/editorial landing theme (app/clawlaunch/page.tsx):
 * warm paper, near-black ink, serif-italic display, Geist-Mono eyebrow.
 * Single-field email form → `waitlist:mayaProductWaitlist` mutation.
 */
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { WaitlistForm } from "./WaitlistForm";

export const metadata: Metadata = {
  title: "HeyMaya — Join the Waitlist",
  description:
    "Drop your email and we'll let you know the moment there's a seat for you.",
};

export default function WaitlistPage() {
  return (
    <main className="relative min-h-screen bg-[#fbfaf6] font-sans text-[#0a0a0a] antialiased">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-7 sm:px-10">
        <Link
          href="/"
          className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.22em] text-[#0a0a0a]/70 hover:text-[#0a0a0a]"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> HeyMaya
        </Link>
      </header>

      <section className="mx-auto flex min-h-[70vh] max-w-2xl flex-col justify-center px-6 pb-24 sm:px-10">
        <p className="mb-5 font-mono text-[11px] uppercase tracking-[0.22em] text-[#0a0a0a]/50">
          Join the Waitlist
        </p>
        <h1 className="font-display italic text-[clamp(2.6rem,7vw,4.5rem)] leading-[1] tracking-tight">
          Almost ready for you.
        </h1>
        <p className="mt-6 max-w-md text-[17px] leading-[1.55] text-[#0a0a0a]/65">
          Drop your email and we&apos;ll text you the moment there&apos;s a
          seat. No spam, no decks.
        </p>

        <div className="mt-9 max-w-md">
          <WaitlistForm />
        </div>
      </section>
    </main>
  );
}
