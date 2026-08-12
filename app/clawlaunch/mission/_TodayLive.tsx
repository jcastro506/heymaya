"use client";

/**
 * ⭐ Today, from the live module (§16.2 — "the 30-second check").
 *
 * ## Why this exists
 *
 * Mission Control's Today, Results and Activity screens read `gtmMaya`
 * exclusively — the frozen product. The live module writes to `placements`,
 * `messages` and `dashboardState`.
 *
 * ⚠️ So for a `v2` customer the dashboard is **blank while she is working**.
 * Verified on the dogfood account 2026-08-12: `placements` holds real posts
 * including one published that day; `gtmPostResults`, which the Results list
 * renders, is **empty**. A founder asking §18.9's exit question — *"is this
 * working?"* — gets nothing.
 *
 * ⭐ And the backend for this already existed. `maya.dashboard.myDashboard`
 * had **zero readers** outside a test mock. The answer was being computed
 * every refresh and shown to nobody, which is this codebase's most common
 * defect by a distance.
 *
 * ## Additive on purpose
 *
 * This renders only when the signed-in account has a live customer
 * (`ok: true`). It removes nothing and repoints nothing — the cutover from the
 * frozen dashboard is an operator decision, and a gtm-only account sees
 * exactly what it saw before.
 */

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Panel, Rise } from "./_components";

function daysAgo(ts: number): string {
  const days = Math.floor((Date.now() - ts) / 86_400_000);
  if (days <= 0) return "today";
  return days === 1 ? "yesterday" : `${days} days ago`;
}

export function TodayLive() {
  const data = useQuery(api.maya.dashboard.myDashboard, {});

  // Loading, signed out, or a gtm-only account — render nothing rather than an
  // empty panel that implies she has done nothing.
  if (!data?.ok) return null;

  const placements = data.todayPlacements ?? [];
  const ladder = data.ladder ?? [];

  return (
    <Rise className="mc-a-live">
      <Panel title="Today">
        {/* Her own status line — one sentence, already plain language. */}
        {data.statusLine && (
          <p className="text-sm text-paper">{data.statusLine}</p>
        )}

        {/* ⚠️ Anything waiting on the founder comes FIRST and is the loudest
            thing here. An unanswered question blocked her for two days on
            2026-08-08 because nothing surfaced it. */}
        {data.needsYou && (
          <div className="mt-3 rounded border border-amber-500/40 bg-amber-500/10 p-2">
            <p className="text-xs font-semibold text-amber-200">
              She&apos;s waiting on you
            </p>
            <p className="mt-1 text-sm text-amber-100">{data.needsYou}</p>
          </div>
        )}

        {/* ⭐ The unit of work is a placement — something live, with a URL
            (§2.6). Drafts are inventory and deliberately absent. */}
        <div className="mt-3">
          {placements.length === 0 ? (
            /* §12: honest silence beats fake activity. A quiet day says so. */
            <p className="text-sm text-paper-faint">
              Nothing published yet today.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {placements.map((p) => (
                <li key={p.placementId} className="text-sm">
                  <span className="text-paper-faint">{p.channel}</span>{" "}
                  {p.url ? (
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-paper underline"
                    >
                      see it
                    </a>
                  ) : (
                    <span className="text-paper-faint">going out now</span>
                  )}
                  <span className="ml-2 text-xs text-paper-faint">
                    {p.views.toLocaleString()} views
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Her read per channel. The rung is the actionable part, not the
            number — §16.3, context is the product. */}
        {ladder.length > 0 && (
          <div className="mt-4 space-y-2 border-t border-white/10 pt-3">
            {ladder.map((row) => (
              <div key={row.channel}>
                <p className="text-sm text-paper">{row.detail}</p>
                {row.versusNiche && (
                  <p className="text-xs text-paper-faint">{row.versusNiche}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ⚠️ §16.4 — every borrowed number carries its age. A metric with no
            date is one that will eventually lie with nothing to give it away. */}
        <p className="mt-3 text-xs text-paper-faint">
          {data.metricsAsOf
            ? `Numbers last checked ${daysAgo(data.metricsAsOf)}.`
            : "Numbers haven't come back yet."}{" "}
          <Link href="/clawlaunch/mission/house-rules" className="underline">
            House Rules
          </Link>
        </p>
      </Panel>
    </Rise>
  );
}
