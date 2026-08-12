"use client";

/**
 * ⭐ Results, from the live module (§16.2 — "the retention screen. The reason
 * they don't cancel.")
 *
 * ⚠️ The Results screen reads `gtmMaya.missionControl.getMyConversions` and
 * `gtmPostResults` — the frozen product's tables, which the live module never
 * writes. Its `LadderBlock` was already live; everything around it was blank.
 *
 * ## Why the untraced number is shown at all
 *
 * §5.0.0 and §14.45: a broken attribution chain is **reported**, never guessed
 * at. So this says *"3 signups — I can point to the post for 2, and can't for
 * the other one"* rather than quietly reporting 2.
 *
 * ⭐ That gap is the credible part. An attribution figure with no remainder is
 * a figure that flatters us, and a founder who later finds an untracked signup
 * stops believing the rest of the screen.
 */

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Panel, Rise } from "./../_components";

export function ResultsLive() {
  const data = useQuery(api.maya.attribution.myResults, {});

  if (!data?.ok) return null;

  const { total, traced, untraced, windowDays } = data;

  return (
    <Rise className="mc-a-live-results">
      <Panel title="What it actually produced">
        {total === 0 ? (
          /**
           * §12 — honest silence beats fake activity. A zero says so and says
           * what would change it, rather than showing reach numbers that
           * substitute motion for results (§2.6).
           */
          <p className="text-sm text-paper-faint">
            No signups traced back to her yet in the last {windowDays} days.
            That&apos;s the number she&apos;s working on.
          </p>
        ) : (
          <>
            <p className="text-2xl font-semibold text-paper">{total}</p>
            <p className="mt-0.5 text-sm text-paper">
              {total === 1 ? "signup" : "signups"} in the last {windowDays} days
            </p>

            {/* ⭐ §5.0.0's sentence — with the remainder, always. */}
            <p className="mt-3 text-sm text-paper-dim">
              {untraced === 0
                ? `I can point to the post for ${traced === 1 ? "it" : "each one"}.`
                : `I can point to the post for ${traced}, and can't for the other ${untraced}.`}
            </p>

            {untraced > 0 && (
              /* ⚠️ Named as a limit of the method, not as a failure of theirs.
                 §14.45 — the chain breaks at a knowable place, and saying so
                 is what keeps the traced number believable. */
              <p className="mt-1 text-xs text-paper-faint">
                Untraced usually means they arrived without the link — a
                screenshot, a DM, or someone retelling it.
              </p>
            )}
          </>
        )}
      </Panel>
    </Rise>
  );
}
