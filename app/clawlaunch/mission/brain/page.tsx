"use client";

/**
 * Brain — Maya's inspectable working model, grounded and correctable.
 *
 *   1. Her read: your product, your buyer (verbatim complaints + sources),
 *      the channel bets and why, the angles, her voice calibration.
 *   2. Standing instructions — read the current rules, add one; Maya
 *      acknowledges in your Telegram thread.
 *   3. Competitor watch — the field, with receipts, and their latest moves.
 *   4. Archive — the approved plan doc, collapsed.
 *
 * Everything cites the data (source chips) and everything is a live Convex
 * subscription — when Maya refreshes her research, this page updates itself.
 */

import type { CSSProperties } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  Card,
  Empty,
  Loading,
  NeedsOnboarding,
  Pill,
  Rise,
  Section,
  Shell,
  SourceChip,
  timeAgo,
} from "../_components";
import { PlanArchive } from "../_PlanCard";
import { FoundationInsights } from "./_FoundationInsights";
import { StandingInstructions } from "./_StandingInstructions";

const KIND_TONE: Record<string, "lime" | "paper" | "rose"> = {
  direct: "rose",
  adjacent: "paper",
  substitute: "paper",
};

const MOVE_LABEL: Record<string, string> = {
  feature_ship: "shipped a feature",
  campaign: "ran a campaign",
  milestone: "hit a milestone",
  pricing_change: "changed pricing",
  partnership: "partnered up",
  incident: "had an incident",
};

/** Defensive render of the voice-profile JSON — strings and string-arrays
 *  only, so whatever shape Maya saved reads cleanly without leaking infra. */
function VoiceCard({ voice }: { voice: unknown }) {
  if (!voice || typeof voice !== "object") return null;
  const entries = Object.entries(voice as Record<string, unknown>)
    .map(([k, v]) => {
      if (typeof v === "string" && v.trim()) return [k, v] as const;
      if (Array.isArray(v)) {
        const items = v.filter((x): x is string => typeof x === "string" && x.trim() !== "");
        if (items.length > 0) return [k, items.join(" · ")] as const;
      }
      return null;
    })
    .filter((e): e is readonly [string, string] => e !== null)
    .slice(0, 8);
  if (entries.length === 0) return null;

  return (
    <Section title="Her voice calibration">
      <Rise>
        <Card>
          <dl className="space-y-2.5">
            {entries.map(([k, v]) => (
              <div key={k}>
                <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
                  {k.replace(/([A-Z])/g, " $1").replace(/_/g, " ").toLowerCase()}
                </dt>
                <dd className="mt-0.5 text-sm leading-relaxed text-paper">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 border-t border-paper-faint/10 pt-3 text-[11px] text-paper-faint">
            How she writes when she writes as you. Off? Tell her below.
          </p>
        </Card>
      </Rise>
    </Section>
  );
}

export default function BrainPage() {
  const snapshot = useQuery(api.gtmMaya.researchLifecycle.getMyGtmSnapshot);
  const insights = useQuery(api.gtmMaya.missionControl.getMyFoundationInsights);
  const competitors = useQuery(api.gtmMaya.missionControl.getMyCompetitiveMap);
  const moves = useQuery(api.gtmMaya.missionActions.getMyCompetitorMoves, {});

  if (snapshot === undefined || insights === undefined || competitors === undefined)
    return <Loading />;
  if (snapshot === null) return <NeedsOnboarding />;

  const comps = competitors ?? [];
  const hasModel = insights.hasFoundation || Boolean(insights.productPicture);

  return (
    <Shell
      title="Brain"
      subtitle="Everything Maya knows and every call she's made — grounded in real threads, not guesses. Correct her anytime; she updates."
    >
      {/* ── Her working model ─────────────────────────────────────────── */}
      {hasModel ? (
        <FoundationInsights data={insights} />
      ) : (
        <div className="mb-11">
          <Empty
            title="Research in progress"
            body="Maya is still mapping your buyers, competitors, and channels — her working model fills in here within her first research pass."
          />
        </div>
      )}

      {/* ── Voice ─────────────────────────────────────────────────────── */}
      <VoiceCard voice={insights.voice} />

      {/* ── Standing instructions ─────────────────────────────────────── */}
      <Section title="Standing instructions">
        <StandingInstructions />
      </Section>

      {/* ── Competitor watch ──────────────────────────────────────────── */}
      {comps.length > 0 ? (
        <Section title="Competitor watch" count={comps.length}>
          <ol className="space-y-3">
            {comps.map((c, i) => (
              <li key={c._id} className="mc-rise" style={{ "--i": i } as CSSProperties}>
                <Card>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-lg leading-none text-paper">
                      {c.competitorName}
                    </span>
                    <Pill tone={KIND_TONE[c.kind] ?? "paper"}>{c.kind}</Pill>
                    {c.pricing ? <Pill tone="paper">{c.pricing}</Pill> : null}
                    {c.url ? (
                      <span className="ml-auto">
                        <SourceChip url={c.url} />
                      </span>
                    ) : null}
                  </div>

                  {c.positioning ? (
                    <p className="mt-2 text-sm leading-relaxed text-paper-dim">
                      {c.positioning}
                    </p>
                  ) : null}

                  {c.vulnerabilities.length > 0 ? (
                    <div className="mt-3">
                      <p className="font-mono text-[11px] uppercase tracking-wide text-paper-faint">
                        Where they&apos;re weak
                      </p>
                      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-paper">
                        {c.vulnerabilities.map((vuln, j) => (
                          <li key={j}>{vuln}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {c.complaints.length > 0 ? (
                    <div className="mt-3">
                      <p className="font-mono text-[11px] uppercase tracking-wide text-paper-faint">
                        What their customers say
                      </p>
                      <ul className="mt-2 space-y-2">
                        {c.complaints.map((complaint, j) => (
                          <li
                            key={j}
                            className="rounded-lg border-l-2 border-lime/40 bg-ink/50 py-2 pl-3 pr-2"
                          >
                            <p className="text-sm italic leading-relaxed text-paper">
                              “{complaint.quote}”
                            </p>
                            {complaint.sourceUrl ? (
                              <div className="mt-1.5">
                                <SourceChip url={complaint.sourceUrl} />
                              </div>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </Card>
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      {/* ── Competitor moves — the field, this week ───────────────────── */}
      {(moves ?? []).length > 0 ? (
        <Section title="What competitors just did" count={(moves ?? []).length}>
          <ol className="space-y-2">
            {(moves ?? []).map((m) => (
              <li key={m._id}>
                <Card className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm text-paper">
                      <span className="font-medium">{m.competitorName}</span>{" "}
                      {MOVE_LABEL[m.moveKind] ?? m.moveKind}: {m.summary}
                    </p>
                    {m.recommendedCounter ? (
                      <p className="mt-1 text-xs leading-relaxed text-paper-dim">
                        Maya&apos;s counter: {m.recommendedCounter}
                      </p>
                    ) : null}
                    <div className="mt-1.5">
                      <SourceChip url={m.sourceUrl} />
                    </div>
                  </div>
                  <span className="shrink-0 font-mono text-[11px] text-paper-faint">
                    {timeAgo(m.observedAt)}
                  </span>
                </Card>
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      {/* ── Archive — the plan doc, collapsed ─────────────────────────── */}
      <PlanArchive />
    </Shell>
  );
}
