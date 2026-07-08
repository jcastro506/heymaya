"use client";

/**
 * Brain — what Maya knows, what she decided, and what the field is doing.
 * v2 merge of the old Research tab + the foundation insights that used to
 * hide inside Thinking. Order tells the story:
 *   1. Her read on your product + the channel bets (with the WHY)
 *   2. Who we're targeting (buyer map)
 *   3. The competition — and their latest moves
 *   4. The watchlist — live conversations she's tracking right now
 * All grounded in real threads. Live-subscribed.
 */

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  Shell,
  Section,
  Card,
  Pill,
  Loading,
  Empty,
  NeedsOnboarding,
  timeAgo,
  ExtLink,
} from "../_components";
import { FoundationInsights } from "./_FoundationInsights";
import { PlanApproval } from "./_PlanApproval";

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

const THREAD_STATUS_PILL: Record<string, { label: string; tone: "lime" | "paper" | "rose" }> = {
  queued: { label: "watching", tone: "paper" },
  replied: { label: "replied", tone: "lime" },
  dropped: { label: "passed", tone: "paper" },
  expired: { label: "went cold", tone: "paper" },
};

export default function BrainPage() {
  const snapshot = useQuery(api.gtmMaya.researchLifecycle.getMyGtmSnapshot);
  const insights = useQuery(api.gtmMaya.missionControl.getMyFoundationInsights);
  const buyerMap = useQuery(api.gtmMaya.missionControl.getMyBuyerMap);
  const competitors = useQuery(api.gtmMaya.missionControl.getMyCompetitiveMap);
  const moves = useQuery(api.gtmMaya.missionActions.getMyCompetitorMoves, {});
  const threads = useQuery(api.gtmMaya.targetList.getMyTargetThreads, {});

  if (
    snapshot === undefined ||
    buyerMap === undefined ||
    competitors === undefined
  )
    return <Loading />;
  if (snapshot === null) return <NeedsOnboarding />;

  const stages = buyerMap?.buyerJourneyStages ?? [];
  const intentPhrases = buyerMap?.intentPhrases ?? [];
  const trustedVoices = buyerMap?.trustedVoices ?? [];
  const comps = competitors ?? [];
  const watchlist = (threads ?? [])
    .filter((t) => t.status === "queued" || t.status === "replied")
    .sort((a, b) => {
      // Buying-intent (T1) first, then freshest.
      const tier = (t: { tier?: string }) => (t.tier === "T1" ? 0 : t.tier === "T2" ? 1 : 2);
      return tier(a) - tier(b) || b.createdAt - a.createdAt;
    })
    .slice(0, 12);

  if (!buyerMap && comps.length === 0 && !insights) {
    return (
      <Shell
        title="Brain"
        subtitle="Everything Maya knows about your product, your buyers, and your competition — grounded in real threads, not guesses."
      >
        <Empty
          title="Research in progress"
          body="Maya is still mapping your buyers and competitors — this fills in within ~15 minutes of going live."
        />
      </Shell>
    );
  }

  return (
    <Shell
      title="Brain"
      subtitle="Everything Maya knows and every call she's made — grounded in real threads, not guesses."
    >
      {/* ───────── The plan — read, argue (in Telegram), approve ───────── */}
      <PlanApproval />

      {/* ───────── Her strategy read: product picture, channel bets, angles ───────── */}
      {insights ? <FoundationInsights data={insights} /> : null}

      {/* ───────── The watchlist — conversations in play right now ───────── */}
      <Section title="On her radar" count={watchlist.length}>
        {watchlist.length === 0 ? (
          <Empty
            title="No live threads yet"
            body="As Maya finds conversations worth joining — people asking for exactly what you built — they show up here with her plan for each."
          />
        ) : (
          <ol className="space-y-2">
            {watchlist.map((t) => {
              const pill = THREAD_STATUS_PILL[t.status] ?? {
                label: t.status,
                tone: "paper" as const,
              };
              return (
                <li key={t._id}>
                  <Card className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Pill tone="paper">{t.platform === "x" ? "X" : t.platform}</Pill>
                        <Pill tone={pill.tone}>{pill.label}</Pill>
                        {t.tier ? (
                          <span className="font-mono text-[10px] uppercase tracking-wide text-paper-faint">
                            {t.tier === "T1" ? "buying intent" : t.tier}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-2 text-sm leading-snug text-paper">
                        {t.title ?? t.excerpt?.slice(0, 120) ?? t.url}
                      </p>
                      <p className="mt-1 text-xs">
                        <ExtLink href={t.url}>open the thread ↗</ExtLink>
                      </p>
                    </div>
                    <span className="shrink-0 font-mono text-[11px] text-paper-faint">
                      {timeAgo(t.createdAt)}
                    </span>
                  </Card>
                </li>
              );
            })}
          </ol>
        )}
      </Section>

      {/* ───────── Who we're targeting ───────── */}
      <Section title="Who we're targeting">
        {buyerMap ? (
          <div className="space-y-4">
            {buyerMap.icpDescription ? (
              <Card>
                <p className="font-mono text-[11px] uppercase tracking-wide text-paper-faint">
                  Your buyer
                </p>
                <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-paper">
                  {buyerMap.icpDescription}
                </p>
              </Card>
            ) : null}

            {stages.length > 0 ? (
              <div>
                <p className="mb-2 font-mono text-[11px] uppercase tracking-wide text-paper-faint">
                  How they move toward buying
                </p>
                <ol className="space-y-2">
                  {stages.map((s, i) => (
                    <li key={i}>
                      <Card>
                        <div className="flex items-center gap-2">
                          <Pill tone="lime">{s.stage}</Pill>
                        </div>
                        {s.whereTheyHangOut ? (
                          <p className="mt-2 text-sm text-paper">
                            <span className="text-paper-faint">Where they hang out: </span>
                            {s.whereTheyHangOut}
                          </p>
                        ) : null}
                        {s.intentLanguage ? (
                          <p className="mt-1 text-sm text-paper-dim">
                            <span className="text-paper-faint">
                              Language that signals intent:{" "}
                            </span>
                            {s.intentLanguage}
                          </p>
                        ) : null}
                      </Card>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}

            {intentPhrases.length > 0 ? (
              <div>
                <p className="mb-2 font-mono text-[11px] uppercase tracking-wide text-paper-faint">
                  In-market phrases to watch for
                </p>
                <div className="flex flex-wrap gap-2">
                  {intentPhrases.map((phrase, i) => (
                    <Pill key={i} tone="paper">
                      {phrase}
                    </Pill>
                  ))}
                </div>
              </div>
            ) : null}

            {trustedVoices.length > 0 ? (
              <div>
                <p className="mb-2 font-mono text-[11px] uppercase tracking-wide text-paper-faint">
                  Voices they trust
                </p>
                <ul className="space-y-2">
                  {trustedVoices.map((voice, i) => (
                    <li key={i}>
                      <Card>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-paper">{voice.handle}</span>
                          {voice.platform ? <Pill tone="paper">{voice.platform}</Pill> : null}
                        </div>
                        {voice.whyTrusted ? (
                          <p className="mt-1 text-xs leading-relaxed text-paper-dim">
                            {voice.whyTrusted}
                          </p>
                        ) : null}
                      </Card>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : (
          <Empty
            title="Mapping your buyers"
            body="Maya is still figuring out exactly who to target — your buyer map shows up here as soon as it's ready."
          />
        )}
      </Section>

      {/* ───────── The competition ───────── */}
      <Section title="The competition" count={comps.length}>
        {comps.length === 0 ? (
          <Empty
            title="Scoping the field"
            body="Maya is still sizing up your competitors and the threads where their customers complain — they land here next."
          />
        ) : (
          <ol className="space-y-3">
            {comps.map((c) => (
              <li key={c._id}>
                <Card>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-lg leading-none text-paper">
                      {c.url ? <ExtLink href={c.url}>{c.competitorName}</ExtLink> : c.competitorName}
                    </span>
                    <Pill tone={KIND_TONE[c.kind] ?? "paper"}>{c.kind}</Pill>
                    {c.pricing ? <Pill tone="paper">{c.pricing}</Pill> : null}
                  </div>

                  {c.positioning ? (
                    <p className="mt-2 text-sm leading-relaxed text-paper-dim">{c.positioning}</p>
                  ) : null}

                  {c.vulnerabilities.length > 0 ? (
                    <div className="mt-3">
                      <p className="font-mono text-[11px] uppercase tracking-wide text-paper-faint">
                        Where they&apos;re weak
                      </p>
                      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-paper">
                        {c.vulnerabilities.map((vuln, i) => (
                          <li key={i}>{vuln}</li>
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
                        {c.complaints.map((complaint, i) => (
                          <li
                            key={i}
                            className="rounded-lg border-l-2 border-lime/40 bg-ink/40 py-2 pl-3 pr-2"
                          >
                            <p className="text-sm italic leading-relaxed text-paper">
                              “{complaint.quote}”
                            </p>
                            {complaint.sourceUrl ? (
                              <p className="mt-1 text-xs">
                                <ExtLink href={complaint.sourceUrl}>see the thread ↗</ExtLink>
                              </p>
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
        )}
      </Section>

      {/* ───────── Competitor moves — the field, this week ───────── */}
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
                    <p className="mt-1 text-xs">
                      <ExtLink href={m.sourceUrl}>source ↗</ExtLink>
                    </p>
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
    </Shell>
  );
}
