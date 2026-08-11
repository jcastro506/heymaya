"use client";

/**
 * ⭐ The Plan screen (§16.75) — who we're targeting, and why it changed.
 *
 * > *"I trimmed this out when cutting to six screens. **That was wrong** — the
 * > strategy is the most interesting thing she produces, and it's invisible."*
 *
 * Four blocks: who we're targeting · the bet · the current strategy · what
 * changed and why.
 *
 * ## The changelog is the point
 *
 * §16.75.1 calls it *"the single strongest trust artifact in the product"* — it
 * proves she is adapting rather than merely running, and every entry names the
 * data that caused it.
 *
 * ⚠️ Including the entries where **nothing changed**. A log that shows only
 * changes makes a steady month look like an absent one, and "nothing's
 * changing, here's why" is the entry that proves she was looking.
 *
 * ## ⚠️ Steering happens in chat, not here
 *
 * §16.75.1: *"The screen shows what the strategy IS; changing it is a sentence
 * to her, which then appears here as the next entry."* So there is deliberately
 * no edit control on this page — a second way to change strategy is a second
 * place for it to disagree with itself.
 */

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

/** §16.75: a stale buyer map silently poisons ideas, formats and benchmarks. */
const STALE_TARGETING_DAYS = 31;

export function PlanScreen() {
  const plan = useQuery(api.maya.strategy.planScreen, {});

  /**
   * ⚠️ `!plan`, not `plan === undefined`.
   *
   * `useQuery` returns `undefined` while loading — but it can also hand back
   * `null`, and checking only for `undefined` let the next line read `.ok` off
   * null and crash the whole screen. Caught by the SSR smoke test, which
   * renders every tab in exactly that state on purpose.
   */
  if (!plan) {
    return <p className="p-4 text-sm text-paper-faint">Loading the plan…</p>;
  }
  if (!plan.ok) {
    return <p className="p-4 text-sm text-paper-faint">{plan.error}</p>;
  }

  const targeting = plan.targeting;
  const stale =
    targeting?.staleDays !== null &&
    targeting !== undefined &&
    (targeting.staleDays ?? 0) > STALE_TARGETING_DAYS;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-8 p-4">
      {/* ── Block 1: who we're targeting ─────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-paper-faint">
          Who we&apos;re targeting
        </h2>
        {targeting && targeting.keywords.length > 0 ? (
          <>
            <ul className="mt-2 flex flex-wrap gap-2">
              {targeting.keywords.map((k) => (
                <li
                  key={k}
                  className="rounded border border-white/15 px-2 py-1 text-sm text-paper"
                >
                  {k}
                </li>
              ))}
            </ul>

            {targeting.accounts.length > 0 && (
              <p className="mt-2 text-sm text-paper-faint">
                Watching {targeting.accounts.slice(0, 6).join(" · ")}
                {targeting.accounts.length > 6
                  ? ` and ${targeting.accounts.length - 6} more`
                  : ""}
              </p>
            )}

            {/* ⚠️ §16.75's own warning. Shown so it can be acted on rather
                than silently trusted. */}
            {stale && (
              <p className="mt-2 text-sm text-amber-300">
                This is {targeting.staleDays} days old — worth telling her if
                your market has moved.
              </p>
            )}

            {/* ⭐ "The judge approved everything" and "the judge never ran"
                produce an identical list. The founder is owed the difference. */}
            {targeting.relevance === "unavailable" && (
              <p className="mt-1 text-sm text-amber-300">
                She couldn&apos;t double-check this list last time it was built.
              </p>
            )}
          </>
        ) : (
          <p className="mt-2 text-sm text-paper-faint">
            She hasn&apos;t worked out who your buyers are yet.
          </p>
        )}
      </section>

      {/* ── Block 2: the bet ─────────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-paper-faint">
          The bet
        </h2>
        <p className="mt-2 text-sm text-paper">
          {plan.bet && plan.bet.channels.length > 0
            ? plan.bet.channels.join(" · ")
            : "No channels connected yet."}
        </p>
      </section>

      {/* ── Block 4: what changed, and why ───────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-paper-faint">
          What changed, and why
        </h2>

        {plan.changelog && plan.changelog.length > 0 ? (
          <ol className="mt-2 space-y-4">
            {plan.changelog.map((entry) => (
              <li key={`${entry.day}-${entry.trigger}`} className="text-sm">
                <div className="text-paper">
                  <span className="text-paper-faint">{entry.day}</span>{" "}
                  {/* ⭐ A no-change week is an entry, not a gap. */}
                  {entry.change || "nothing changed"}
                </div>
                <div className="mt-0.5 italic text-paper-faint">
                  {entry.because}
                </div>
                {/* The feasibility gate's ask — a change she couldn't execute
                    became a request instead of a promise. */}
                {entry.askedFor && (
                  <div className="mt-1 rounded border border-white/10 p-2 text-paper-faint">
                    {entry.askedFor}
                  </div>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 text-sm text-paper-faint">
            Nothing yet — she reviews the strategy once a week.
          </p>
        )}

        {/* §16.75.1: steering happens in chat. Said, so the absence of an edit
            control reads as deliberate rather than missing. */}
        <p className="mt-4 text-xs text-paper-faint">
          To change any of this, just tell her. It&apos;ll show up here as the
          next entry.
        </p>
      </section>
    </div>
  );
}
