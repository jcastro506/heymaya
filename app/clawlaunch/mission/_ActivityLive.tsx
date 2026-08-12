"use client";

/**
 * ⭐ Activity, from the live module (§16.8.6 — "the trust engine").
 *
 * > *"Every placement, newest first, with the real thumbnail and its live
 * > metrics, linking out to the actual post… they scroll it and **see** her
 * > being native."*
 *
 * > *"**Still a feed, never a table** — the emotional job is watching a year of
 * > her work stack up."*
 *
 * ⚠️ Mission Control's Activity screen reads
 * `gtmMaya.missionControl.getMyAgentActivity`, backed by the frozen product's
 * tables. The live module writes to `placements`. So a v2 founder scrolls an
 * empty feed while her posts exist — the exact opposite of a trust engine.
 *
 * The archive backend was already correct and had zero readers; this renders
 * it. Additive, like `TodayLive` — a gtm-only account sees nothing new.
 */

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Panel, Rise } from "./_components";

function when(ts: number): string {
  const days = Math.floor((Date.now() - ts) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(ts).toLocaleDateString();
}

export function ActivityLive() {
  const data = useQuery(api.maya.archive.myActivity, {});

  if (!data?.ok) return null;
  const entries = data.entries ?? [];

  return (
    <Rise className="mc-a-live-activity">
      <Panel title="Everything she's published">
        {entries.length === 0 ? (
          /* §12 — an honest empty state. Day one is the moment of maximum
             doubt, and a blank panel with no sentence confirms the fear. */
          <p className="text-sm text-paper-faint">
            Nothing published yet. The first one shows up here the moment it
            goes live.
          </p>
        ) : (
          <ul className="space-y-3">
            {entries.map((e) => (
              <li
                key={e.placementId}
                className="border-b border-white/5 pb-3 last:border-0 last:pb-0"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-xs uppercase tracking-wide text-paper-faint">
                    {e.channel}
                  </span>
                  <span className="shrink-0 text-xs text-paper-faint">
                    {when(e.publishedAt)}
                  </span>
                </div>

                {/* Her actual words, as published. The snapshot is kept even
                    when the post is gone — §16.8.1. */}
                <p className="mt-1 text-sm leading-relaxed text-paper">
                  {e.text}
                </p>

                <div className="mt-1.5 flex items-center gap-3 text-xs">
                  {/**
                   * ⚠️ `tappable` decides this, NOT the presence of a URL. A
                   * dead link renders as "no longer live" with the text
                   * preserved — never a broken tap, which is the failure that
                   * makes an archive feel like a lie rather than a record.
                   */}
                  {e.tappable && e.url ? (
                    <a
                      href={e.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-paper underline"
                    >
                      see it
                    </a>
                  ) : (
                    <span className="text-paper-faint">{e.linkNote}</span>
                  )}

                  {/* §16.4 — a number with no age eventually lies. "Not
                      measured yet" and "zero views" are different claims. */}
                  {e.metricsAsOf ? (
                    <span className="text-paper-faint">
                      {e.views.toLocaleString()} views · as of{" "}
                      {when(e.metricsAsOf)}
                    </span>
                  ) : (
                    <span className="text-paper-faint">
                      numbers not back yet
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </Rise>
  );
}
