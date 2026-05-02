import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Privacy Policy | HeyMaya",
  description:
    "How HeyMaya handles creator profile, TikTok, calendar, phone, and messaging data.",
};

const updated = "May 2, 2026";

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-ink text-paper">
      <LegalHeader />
      <article className="mx-auto max-w-3xl px-5 pb-20 pt-10 sm:px-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-paper-faint">
          Last updated {updated}
        </p>
        <h1 className="mt-4 font-display text-5xl leading-tight text-paper">
          Privacy Policy
        </h1>
        <p className="mt-5 text-base leading-relaxed text-paper-dim">
          HeyMaya is built for content creators. Maya uses the context you
          provide to plan content, suggest filming windows, and message you in
          the channels you connect. We collect only the data needed to make
          that workflow useful.
        </p>

        <LegalSection title="Data We Collect">
          <p>
            We collect account information such as your name, email address,
            phone number, and authentication identifiers. During onboarding we
            collect creator context such as your niche, goals, blockers, tone
            preference, TikTok handle, availability, and content boundaries.
          </p>
          <p>
            If you connect TikTok context through supported data providers, we
            may store profile metadata, post metadata, captions, public
            engagement metrics, thumbnails, and selected media references used
            to analyze your creator strategy.
          </p>
          <p>
            If you connect Google Calendar, Maya reads upcoming calendar events
            for planning and may create Maya-owned content holds only when the
            product flow asks for scheduling. Calendar tokens are stored in an
            encrypted form. Calendar events that look personal or private are
            redacted before Maya uses them for creator planning.
          </p>
        </LegalSection>

        <LegalSection title="How We Use Data">
          <p>
            We use your data to create your Creator Maya profile, generate daily
            plans, schedule approved content work blocks, send iMessage-based
            guidance, improve product reliability, prevent abuse, and comply
            with legal obligations.
          </p>
          <p>
            Maya does not sell your personal information. Maya does not email
            brands, create calendar events, or send outbound messages on your
            behalf unless the product tier and approval flow allow it.
          </p>
        </LegalSection>

        <LegalSection title="Google Calendar Data">
          <p>
            HeyMaya uses Google Calendar data to understand your near-term
            schedule, identify content windows, and create or update Maya-owned
            calendar holds when you approve scheduling. We do not use Google
            Calendar data for advertising.
          </p>
          <p>
            We request Calendar access separately from Google sign-in. You can
            disconnect Calendar inside HeyMaya, and you can also revoke access
            from your Google Account permissions page.
          </p>
        </LegalSection>

        <LegalSection title="Sharing">
          <p>
            We share data with infrastructure and product vendors only as needed
            to run HeyMaya, including authentication, database, hosting, calendar
            connection, messaging, AI model, analytics, and social-data
            providers. These providers process data on our behalf.
          </p>
        </LegalSection>

        <LegalSection title="Retention And Deletion">
          <p>
            We keep account and creator data while your account is active or as
            needed for product, security, and legal purposes. You can request
            deletion by emailing support. We will delete or de-identify account
            data unless retention is required by law, security, billing, or
            dispute obligations.
          </p>
        </LegalSection>

        <LegalSection title="Contact">
          <p>
            For privacy, deletion, or security requests, contact{" "}
            <a className="text-lime underline-offset-4 hover:underline" href="mailto:support@hey-maya.ai">
              support@hey-maya.ai
            </a>
            .
          </p>
        </LegalSection>
      </article>
    </main>
  );
}

function LegalHeader() {
  return (
    <header className="border-b border-[var(--hairline)]">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8 lg:px-10">
        <Link href="/" className="flex items-center gap-2" aria-label="HeyMaya home">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-lime font-display text-lg text-ink">
            m
          </span>
          <span className="font-display text-xl text-paper">HeyMaya</span>
        </Link>
        <nav className="flex items-center gap-4 text-sm text-paper-dim">
          <Link href="/terms" className="hover:text-paper">
            Terms
          </Link>
          <Link href="/creator-maya-v0" className="hover:text-paper">
            Start
          </Link>
        </nav>
      </div>
    </header>
  );
}

function LegalSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-10 border-t border-[var(--hairline)] pt-6">
      <h2 className="font-display text-3xl text-paper">{title}</h2>
      <div className="mt-4 space-y-4 text-sm leading-relaxed text-paper-dim">
        {children}
      </div>
    </section>
  );
}
