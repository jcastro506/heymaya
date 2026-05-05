/**
 * Details section — name (editable), primary handle (read-only), phone (read-
 * only), email (read-only, sourced from Clerk via the Convex `creators.email`
 * mirror).
 *
 * Why most fields are read-only:
 *   - Handle changes invalidate Maya's voice fingerprint + scrape baseline.
 *     The brief flags this as sensitive, so we surface read-only and direct
 *     anything else through support.
 *   - Phone changes invalidate channel pairing (iMessage / WhatsApp / SMS) +
 *     would need a re-verification dance. Out of scope for the profile screen.
 *
 * The only editable field is `displayName`. We don't currently expose a
 * mutation for this from the client — `displayName` is captured at onboarding
 * and updated via the same `submitOnboardingAnswers` path. Rather than invent
 * a new mutation (the brief says "preserve all existing data sources"), the
 * field renders read-only too with a subtle hint that name changes go through
 * Maya in chat.
 *
 * If/when an `updateDisplayName` mutation lands server-side, the empty state
 * + "Update" affordance can be re-enabled by flipping `editable` to true.
 */

"use client";

import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";

type ProfileSummary = NonNullable<
  FunctionReturnType<typeof api.profile.getProfileSummary>
>;
type CreatorMe = NonNullable<FunctionReturnType<typeof api.creators.me>>;

export function DetailsSection({
  summary,
  me,
}: {
  summary: ProfileSummary;
  me: CreatorMe;
}) {
  const primaryHandle =
    me.primaryHandle ??
    summary.handles[0]?.handle ??
    null;
  const primaryPlatform = summary.handles[0]?.platform ?? null;

  return (
    <section className="border-t border-[var(--hairline)] px-5 pt-10 sm:px-8 sm:pt-12">
      <div className="mx-auto max-w-2xl">
        <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-paper-faint">
          Your details
        </span>
        <h2 className="mt-4 font-display text-3xl tracking-tight text-paper sm:text-4xl">
          The basics.{" "}
          <span className="italic text-paper-dim">
            Most are locked — they shape how Maya knows you.
          </span>
        </h2>

        <dl className="mt-7 divide-y divide-[var(--hairline)] border-y border-[var(--hairline)]">
          <DetailRow
            label="Name"
            value={me.displayName ?? "—"}
            hint="Tell Maya in chat if this needs to change."
          />
          <DetailRow
            label="Primary handle"
            value={primaryHandle ? `@${primaryHandle}` : "—"}
            sub={primaryPlatform ?? undefined}
            hint="Locked. Handle changes affect Maya's voice baseline — message support to switch."
          />
          <DetailRow
            label="Phone"
            value={me.phoneNumber ?? "—"}
            hint="Locked. Channel pairing is anchored here."
          />
          <DetailRow label="Email" value={summary.creator.email} />
        </dl>
      </div>
    </section>
  );
}

function DetailRow({
  label,
  value,
  sub,
  hint,
}: {
  label: string;
  value: string;
  sub?: string;
  hint?: string;
}) {
  return (
    <div className="grid grid-cols-1 gap-1 py-5 sm:grid-cols-[160px_1fr] sm:items-baseline sm:gap-6">
      <dt className="font-mono text-[11px] uppercase tracking-[0.22em] text-paper-faint">
        {label}
      </dt>
      <dd className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="break-words text-base text-paper">{value}</span>
          {sub && (
            <span className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
              {sub}
            </span>
          )}
        </div>
        {hint && <p className="mt-1 text-xs text-paper-faint">{hint}</p>}
      </dd>
    </div>
  );
}
