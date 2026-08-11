"use client";

/**
 * ⭐ §16.3's centerpiece — the ladder, benchmarked.
 *
 * > *"Most social dashboards are a vanity-metric wall: followers, likes, reach.
 * > That tells a founder nothing they can act on."*
 *
 * The rung says which step broke. The benchmark says whether the number under
 * it is actually bad — *"is 4.1% good? Nobody knows. **Context is the
 * product.**"*
 *
 * ⚠️ Every borrowed number carries its age (§16.4). A benchmark with no date is
 * a number that will eventually lie, and the founder has no way to tell.
 */

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

/** The rungs, in order, so a break can be shown as a position not a label. */
const RUNGS = ["L1", "L2", "L3", "L4"] as const;

function daysAgo(ts: number): string {
  const days = Math.floor((Date.now() - ts) / 86_400_000);
  if (days <= 0) return "today";
  return days === 1 ? "yesterday" : `${days} days ago`;
}

export function LadderBlock() {
  const data = useQuery(api.maya.dashboard.resultsLadder, {});

  // ⚠️ `!data`, not `=== undefined` — useQuery can hand back null, and reading
  // through it crashes the screen.
  if (!data) return null;
  if (!data.ok || !data.channels || data.channels.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-paper-faint">
        Where it&apos;s working, and where it isn&apos;t
      </h2>

      <div className="mt-3 space-y-5">
        {data.channels.map((c) => {
          const brokenAt = RUNGS.indexOf(c.rung as (typeof RUNGS)[number]);
          return (
            <div key={c.channel} className="rounded border border-white/10 p-3">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-medium text-paper">{c.channel}</span>
                <span className="text-xs text-paper-faint">
                  {c.placements} {c.placements === 1 ? "post" : "posts"} ·{" "}
                  {c.views.toLocaleString()} views
                </span>
              </div>

              {/* The rung as a position, with the break marked. A label alone
                  ("L1") means nothing to a founder. */}
              {brokenAt >= 0 && (
                <div className="mt-2 flex gap-1" aria-label={`broken at ${c.rung}`}>
                  {RUNGS.map((r, i) => (
                    <span
                      key={r}
                      className={`h-1 flex-1 rounded ${
                        i < brokenAt
                          ? "bg-emerald-400/70"
                          : i === brokenAt
                            ? "bg-amber-400"
                            : "bg-white/10"
                      }`}
                    />
                  ))}
                </div>
              )}

              {/* ⭐ Her plain-language read. §16.3 puts this under the rung
                  because the sentence is the actionable part, not the letter. */}
              <p className="mt-2 text-sm text-paper">{c.detail}</p>

              {/* The benchmark column — the part no competitor can copy. */}
              {c.versusNiche ? (
                <p className="mt-1 text-sm text-paper-faint">
                  {c.versusNiche} — from {c.nichePosts} posts in your niche.
                </p>
              ) : (
                /* ⚠️ Said, not hidden. A blank column reads as broken; "not
                   enough of the niche watched yet" reads as honest. */
                <p className="mt-1 text-sm text-paper-faint">
                  Not enough of your niche watched yet to say what normal looks
                  like here.
                </p>
              )}

              {/* §16.3: "which post did it" — a verdict they can check. */}
              {c.topPlacement?.url && (
                <a
                  href={c.topPlacement.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block text-xs text-paper-faint underline"
                >
                  Best one — {c.topPlacement.views.toLocaleString()} views
                </a>
              )}
            </div>
          );
        })}
      </div>

      {/* ⭐ §16.4's honesty rule. Two stamps, because they age differently:
          our own metrics and the borrowed niche medians. */}
      <p className="mt-3 text-xs text-paper-faint">
        {data.metricsAsOf
          ? `Your numbers last checked ${daysAgo(data.metricsAsOf)}.`
          : "Your numbers haven't come back yet."}
        {data.benchmarksComputedAt
          ? ` Niche medians from ${daysAgo(data.benchmarksComputedAt)}${
              data.benchmarksStale ? " — due a refresh" : ""
            }.`
          : ""}
      </p>
    </section>
  );
}
