/**
 * Shared placeholder body for the 6 business HQ screens during Sprint 0.
 *
 * Each `(business)/<screen>/page.tsx` renders this with its own copy. Real
 * screens land in Sprint 4 (Today, Jobs) and Sprint 5 (Reviews, Posts,
 * Customers, Profile) per Service Sprint Plan § 13.
 *
 * Underscore-prefix on the filename keeps Next.js from treating this as a
 * route — only `page.tsx` / `layout.tsx` / `route.ts` / `loading.tsx` etc.
 * become routes; underscore-prefix is the conventional Next.js pattern for
 * "co-located helper that should never resolve as a URL". The route group
 * (`(business)`) groups it alongside the screens but it stays a plain
 * import target.
 */

import { Sparkles } from "lucide-react";

export function Placeholder({
  eyebrow,
  sprint,
  title,
  blurb,
}: {
  eyebrow: string;
  sprint: string;
  title: string;
  blurb: string;
}) {
  return (
    <section className="px-6 py-12 sm:px-10 sm:py-16 lg:px-14 lg:py-20">
      <div className="mx-auto max-w-3xl">
        <span className="font-mono text-xs uppercase tracking-[0.22em] text-paper-faint">
          {eyebrow}
        </span>
        <h1 className="mt-4 font-display text-4xl leading-[1.05] tracking-tight text-paper sm:text-5xl">
          {title}{" "}
          <span className="italic text-paper-dim">— coming {sprint}.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-paper-dim">
          {blurb}
        </p>

        <div className="mt-10 flex items-center gap-2 rounded-2xl border border-[var(--hairline)] bg-ink-2 p-5 text-sm text-paper-dim">
          <Sparkles className="h-4 w-4 shrink-0 text-lime" />
          <span>
            Sprint 0 ships scaffolding only. The route group + nav resolve, the
            screen itself fills in {sprint}.
          </span>
        </div>
      </div>
    </section>
  );
}
