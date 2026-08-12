"use client";

/**
 * ⭐ House Rules — §18.9.3 ⑥, *the proof she remembers*.
 *
 * > *"House Rules earns a top-level slot even though it's not 'data.' Seeing
 * > your own sentences listed back with dates — "July 3: stop posting on
 * > Sundays" — is what convinces someone the agent actually remembers. It's
 * > the single cheapest trust-building screen in the product."*
 *
 * ## What this screen deliberately does not have
 *
 * §18.9.3: *"Each entry is **their own sentence, verbatim, with a date and a
 * revoke ✕.** Nothing else — no editing, no categories, no explanation."*
 *
 * So: no add box, no edit, no grouping by kind, no "what this means" caption.
 *
 * ⚠️ An add box is the tempting one, and it is the wrong direction for the
 * whole product. A rule is something you **told her**, in the messenger. A form
 * for writing rules turns a conversation into configuration, and §2.1 is
 * explicit that the dashboard is *"connect + receipts, never a workbench."*
 * The screen's job is to prove she listened — not to become a second, worse
 * place to talk to her.
 *
 * ⚠️ The verbatim is shown **unedited**, including typos and swearing. A
 * cleaned-up paraphrase would quietly break the only thing this screen is for:
 * recognising your own words.
 */

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  Card,
  Empty,
  Loading,
  NeedsOnboarding,
  Rise,
  Shell,
  monoDate,
} from "../_components";

export default function HouseRulesPage() {
  const data = useQuery(api.maya.directives.myHouseRules, {});
  const revoke = useMutation(api.maya.directives.revokeMyHouseRule);

  /**
   * Ids currently being revoked. Tracked per-row rather than as one page-wide
   * flag: a founder clearing three stale rules shouldn't have the other two
   * freeze while the first is in flight.
   */
  const [pending, setPending] = useState<Set<string>>(new Set());

  if (data === undefined) return <Loading />;
  // `!data.ok` covers both "signed out" and "no account yet" — neither is a
  // House Rules problem, and both have a designed screen already.
  if (!data.ok) return <NeedsOnboarding />;

  const rules = data.rules ?? [];

  const onRevoke = async (id: Id<"directives">) => {
    setPending((p) => new Set(p).add(id));
    try {
      await revoke({ directiveId: id });
    } finally {
      // The row disappears on the next reactive tick; clearing here keeps the
      // button from being stuck if the mutation failed.
      setPending((p) => {
        const next = new Set(p);
        next.delete(id);
        return next;
      });
    }
  };

  return (
    <Shell
      title="House Rules"
      subtitle="Everything you've told her to do differently. She follows the newest first."
    >
      {rules.length === 0 ? (
        <Rise>
          {/* ⚠️ §18.9.3's exact empty state. It points back at the messenger,
              because that is the only place a rule can come from — a blank
              panel on day one confirms the fear that nothing is happening. */}
          <Empty
            title="Nothing yet."
            body="Tell her something in chat and it'll show up here."
          />
        </Rise>
      ) : (
        <ul className="space-y-2">
          {rules.map((rule, i) => {
            const busy = pending.has(rule.id);
            return (
              <Rise key={rule.id} i={Math.min(i, 6)}>
                <li>
                  <Card className="flex items-start justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      {/* ⭐ Their sentence, exactly. The whole screen is this line. */}
                      <p className="text-sm leading-relaxed text-paper break-words">
                        {rule.verbatim}
                      </p>
                      {/* The date is what makes it feel remembered rather than
                          configured — "July 3" is the proof. */}
                      <p className="mt-1 text-xs text-paper-faint">
                        {monoDate(rule.createdAt)}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => onRevoke(rule.id)}
                      disabled={busy}
                      /* Hit target sized for a thumb — this screen is designed
                         at 390px first (§18.9.3), not adapted down later. */
                      className="-mr-1 shrink-0 rounded px-2 py-1 text-base leading-none text-paper-faint transition hover:text-paper disabled:opacity-40"
                      aria-label={`Forget: ${rule.verbatim}`}
                    >
                      {busy ? "…" : "✕"}
                    </button>
                  </Card>
                </li>
              </Rise>
            );
          })}
        </ul>
      )}
    </Shell>
  );
}
