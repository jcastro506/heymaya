import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Terms of Service | HeyMaya",
  description:
    "Terms for using HeyMaya, Creator Maya, calendar planning, and iMessage workflows.",
};

const updated = "May 2, 2026";

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-ink text-paper">
      <LegalHeader />
      <article className="mx-auto max-w-3xl px-5 pb-20 pt-10 sm:px-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-paper-faint">
          Last updated {updated}
        </p>
        <h1 className="mt-4 font-display text-5xl leading-tight text-paper">
          Terms of Service
        </h1>
        <p className="mt-5 text-base leading-relaxed text-paper-dim">
          These terms govern your use of HeyMaya and Creator Maya. By creating
          an account or connecting a service, you agree to use Maya responsibly
          and to keep final control over what gets posted, scheduled, or sent.
        </p>

        <LegalSection title="Product Scope">
          <p>
            Creator Maya helps creators plan content, understand public social
            context, review calendar availability, schedule approved content
            holds, and receive guidance through connected messaging channels.
            Maya is an assistant, not a talent agent, attorney, accountant, or
            financial advisor.
          </p>
        </LegalSection>

        <LegalSection title="Your Responsibilities">
          <p>
            You are responsible for the accuracy of the information you provide,
            for your social-media accounts, for complying with platform rules,
            and for reviewing any content, calendar action, email, or brand
            outreach before it is sent or published.
          </p>
          <p>
            You may not use HeyMaya to spam, harass, impersonate others, scrape
            private data, violate third-party rights, or bypass platform access
            controls.
          </p>
        </LegalSection>

        <LegalSection title="Connected Services">
          <p>
            If you connect Google Calendar, TikTok data providers, messaging,
            or other services, you authorize HeyMaya to access those services
            only for the product features you enable. You can disconnect
            services in the product where supported or by revoking access from
            the connected provider.
          </p>
        </LegalSection>

        <LegalSection title="AI Output">
          <p>
            Maya may generate plans, drafts, summaries, rankings, and outreach
            suggestions. AI output can be wrong, incomplete, or out of date.
            You are responsible for reviewing important decisions and anything
            that will be posted, sent, scheduled, or relied on externally.
          </p>
        </LegalSection>

        <LegalSection title="Beta Availability">
          <p>
            Creator Maya is currently a beta product. Features may change, fail,
            or be unavailable. We may limit access, pause integrations, or
            disable workflows that are unreliable, unsafe, or not approved for
            broader release.
          </p>
        </LegalSection>

        <LegalSection title="Contact">
          <p>
            Questions about these terms can be sent to{" "}
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
          <Link href="/privacy" className="hover:text-paper">
            Privacy
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
