/**
 * Sprint 12.3 — HeyMaya product waitlist landing.
 *
 * Production CTA target when NEXT_PUBLIC_HEYMAYA_LANDING_MODE=waitlist.
 * Single-field email form. Posts to the `waitlist:mayaProductWaitlist`
 * Convex mutation. On success: shows a thank-you state.
 *
 * Server component shell + client form for the interactive bit.
 */
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { WaitlistForm } from "./WaitlistForm";

export const metadata: Metadata = {
  title: "HeyMaya — Join the Waitlist",
  description:
    "Maya is your manager before you have one. Drop your email and we'll text you when there's a seat for you.",
};

export default function WaitlistPage() {
  return (
    <main className="min-h-screen bg-ink text-paper">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-6 sm:px-8 lg:px-10">
        <Link
          href="/"
          className="inline-flex items-center gap-2 font-display text-xl text-paper"
        >
          <ArrowLeft className="h-4 w-4" /> HeyMaya
        </Link>
        <Link
          href="/business"
          className="text-sm text-paper-dim hover:text-paper"
        >
          For Businesses
        </Link>
      </header>

      <section className="mx-auto max-w-2xl px-5 pb-20 pt-20 sm:px-8 sm:pt-32 lg:px-10">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-paper-faint">
          Join the Waitlist
        </p>
        <h1 className="mt-5 font-display text-5xl leading-[0.95] text-paper sm:text-7xl">
          Maya is your manager before you have one.
        </h1>
        <p className="mt-7 max-w-xl text-lg leading-relaxed text-paper-dim">
          We&apos;re onboarding creators in waves. Drop your email and we&apos;ll
          let you know when there&apos;s a seat — usually within a couple of
          weeks. No spam, no decks, just a text from Maya when she&apos;s
          ready for you.
        </p>

        <div className="mt-10">
          <WaitlistForm />
        </div>
      </section>
    </main>
  );
}
