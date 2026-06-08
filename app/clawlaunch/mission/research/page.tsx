"use client";

/**
 * Research / "What we know" — the proof-of-work tab. It surfaces everything the
 * manager dug up so the founder can see she actually did the homework:
 *  1. "Who we're targeting" — the buyer map (ICP, buyer-journey stages,
 *     in-market intent phrases, trusted voices).
 *  2. "The competition" — the competitive map, one card per competitor, each
 *     featuring the verbatim cited complaints that link out to the real thread.
 * Grounded, not guessed. Live-subscribed via useQuery — when OpenClaw POSTs new
 * research the UI re-renders automatically.
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
  ExtLink,
} from "../_components";

const KIND_TONE: Record<string, "lime" | "paper" | "rose"> = {
  direct: "rose",
  adjacent: "lime",
  substitute: "paper",
};

export default function ResearchPage() {
  const snapshot = useQuery(api.gtmMaya.researchLifecycle.getMyGtmSnapshot);
  const buyerMap = useQuery(api.gtmMaya.missionControl.getMyBuyerMap);
  const competitors = useQuery(api.gtmMaya.missionControl.getMyCompetitiveMap);

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

  // Nothing learned yet — research still in flight.
  if (!buyerMap && comps.length === 0) {
    return (
      <Shell
        title="What we know"
        subtitle="Everything your manager dug up about your buyers and your competition — grounded in real threads, not guesses."
      >
        <Empty
          title="Research in progress"
          body="Your manager is still mapping your buyers and competitors — this fills in within ~15 minutes of going live."
        />
      </Shell>
    );
  }

  return (
    <Shell
      title="What we know"
      subtitle="Everything your manager dug up about your buyers and your competition — grounded in real threads, not guesses."
    >
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
                            <span className="text-paper-faint">
                              Where they hang out:{" "}
                            </span>
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
                          <span className="text-sm text-paper">
                            {voice.handle}
                          </span>
                          {voice.platform ? (
                            <Pill tone="paper">{voice.platform}</Pill>
                          ) : null}
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
            body="Your manager is still figuring out exactly who to target — your buyer map shows up here as soon as it's ready."
          />
        )}
      </Section>

      {/* ───────── The competition ───────── */}
      <Section title="The competition" count={comps.length}>
        {comps.length === 0 ? (
          <Empty
            title="Scoping the field"
            body="Your manager is still sizing up your competitors and the threads where their customers complain — they land here next."
          />
        ) : (
          <ol className="space-y-3">
            {comps.map((c) => (
              <li key={c._id}>
                <Card>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-lg leading-none text-paper">
                      {c.url ? (
                        <ExtLink href={c.url}>{c.competitorName}</ExtLink>
                      ) : (
                        c.competitorName
                      )}
                    </span>
                    <Pill tone={KIND_TONE[c.kind] ?? "paper"}>{c.kind}</Pill>
                    {c.pricing ? <Pill tone="paper">{c.pricing}</Pill> : null}
                  </div>

                  {c.positioning ? (
                    <p className="mt-2 text-sm leading-relaxed text-paper-dim">
                      {c.positioning}
                    </p>
                  ) : null}

                  {c.vulnerabilities.length > 0 ? (
                    <div className="mt-3">
                      <p className="font-mono text-[11px] uppercase tracking-wide text-paper-faint">
                        Where they're weak
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
                                <ExtLink href={complaint.sourceUrl}>
                                  see the thread ↗
                                </ExtLink>
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
    </Shell>
  );
}
