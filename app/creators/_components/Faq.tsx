"use client";

import { Plus } from "lucide-react";

const FAQ: { q: string; a: string }[] = [
  {
    q: "What does Maya actually text me?",
    a: "Morning brief at 7am, evening recap at 7pm, Sunday weekly plan, post-publish reads within an hour, brand-email triage as it comes in, accountability nudges if you fall behind. Not chatter — only things that matter, with citations to the post or email she's reading.",
  },
  {
    q: "Does Maya post for me?",
    a: "No. Maya prepares everything — hook, script, caption, suggested time, per-platform variant — for you to post in one tap. We've kept the moment-of-publishing in your hands deliberately. Your account, your voice, your call.",
  },
  {
    q: "Can Maya email a brand without asking me?",
    a: "Only on Manager, only under thresholds you set, and only on the action types you approve (replies, follow-ups, cold pitches). Everything she sends, you see. Anything above your auto-send threshold lands as a draft for your tap.",
  },
  {
    q: "How does the 7-day trial work?",
    a: "No card required. Pick a tier, get 7 days free. On day 5, Maya nudges you to add a card. If you don't, the account quietly stops at the end of day 7 — you keep your data, you keep your memory of Maya, you can come back any time.",
  },
  {
    q: "Which channels does she watch?",
    a: "She reads from TikTok, Instagram, YouTube, LinkedIn, X, and 22 other platforms. She talks to you on iMessage, WhatsApp, SMS, or web — you pick at onboarding and can change any time.",
  },
  {
    q: "What if I don't like her advice?",
    a: "Tell her. She remembers. The whole point is she learns your taste. Most creators tune her tone (supportive / strategic / tough-love) once at onboarding, then refine over the first two weeks. The longer you have her, the more she sounds like she knows you.",
  },
];

export function Faq() {
  return (
    <section id="faq" className="px-6 pt-28 sm:px-10 sm:pt-36 lg:pt-44">
      <div className="mx-auto max-w-7xl">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <span className="font-mono text-xs uppercase tracking-[0.22em] text-paper-faint">
              FAQ
            </span>
            <h2 className="mt-4 font-display text-4xl leading-[1.05] tracking-tight text-paper sm:text-5xl">
              Common questions,{" "}
              <span className="italic text-paper-dim">straight answers.</span>
            </h2>
            <p className="mt-6 text-paper-dim">
              No hedging, no marketing-flavored non-answers. If a question
              isn&rsquo;t here, email{" "}
              <a className="underline hover:text-paper" href="mailto:hi@heymaya.app">
                hi@heymaya.app
              </a>{" "}
              and we&rsquo;ll add it.
            </p>
          </div>
          <div className="lg:col-span-8">
            <div className="overflow-hidden rounded-2xl border border-[var(--hairline-strong)]">
              {FAQ.map((item, i) => (
                <details
                  key={item.q}
                  className={`group bg-ink-2 ${
                    i !== FAQ.length - 1
                      ? "border-b border-[var(--hairline)]"
                      : ""
                  }`}
                >
                  <summary className="flex items-start justify-between gap-6 p-6 sm:p-7">
                    <span className="font-display text-xl leading-snug text-paper sm:text-2xl">
                      {item.q}
                    </span>
                    <span
                      aria-hidden
                      className="faq-plus mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full border border-[var(--hairline-strong)] text-paper-dim"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </span>
                  </summary>
                  <div className="px-6 pb-7 pr-14 text-paper-dim sm:px-7">
                    {item.a}
                  </div>
                </details>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
