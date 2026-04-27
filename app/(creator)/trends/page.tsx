/**
 * Trends screen — surfaces what Maya's intel-gathering crons picked up.
 *
 * Tabs (mobile-first):
 *   1. Niche radar     — daily 6pm scan, fits-your-voice annotations
 *   2. Competitor watch — per-creator named peers, daily 9am
 *   3. Collab matches  — peer suggestions for collab DMs (Pro+)
 *   4. Industry intel  — sidebar on desktop, inline on mobile
 *
 * Cross-tenant + plan-tier gating happens server-side in convex/trends.ts.
 * Pro+ tabs return [] for Starter and we render a friendly "upgrade to see
 * this" empty state — never a hard wall, always a soft pitch.
 */

"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  ArrowUpRight,
  Compass,
  Newspaper,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";
import { Section } from "@/components/creator/Section";

type Tab = "niche" | "competitors" | "collabs";

const TABS: ReadonlyArray<{ id: Tab; label: string; icon: typeof Compass }> = [
  { id: "niche", label: "Niche radar", icon: Compass },
  { id: "competitors", label: "Competitors", icon: Users },
  { id: "collabs", label: "Collabs", icon: Zap },
];

export default function TrendsPage() {
  const [tab, setTab] = useState<Tab>("niche");

  const niche = useQuery(api.trends.nicheRadar);
  const competitors = useQuery(api.trends.competitorWatch);
  const collabs = useQuery(api.trends.collabMatches);
  const intel = useQuery(api.trends.industryIntel);

  return (
    <div className="pt-2 sm:pt-6">
      <Section
        eyebrow="§ Trends"
        title="What Maya is watching"
        caption="Daily niche scan at 6pm. Competitor watch + collab matches at 9am. Industry intel at 7:30am, folded into your morning brief."
        variant="tight"
      >
        <div className="flex flex-wrap gap-2 pt-2">
          {TABS.map((t) => {
            const active = tab === t.id;
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                  active
                    ? "border-lime bg-lime text-ink"
                    : "border-[var(--hairline-strong)] text-paper-dim hover:text-paper"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>
      </Section>

      <div className="grid grid-cols-1 gap-0 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {tab === "niche" && <NicheRadar rows={niche} />}
          {tab === "competitors" && <CompetitorWatch rows={competitors} />}
          {tab === "collabs" && <CollabMatches rows={collabs} />}
        </div>
        <div className="lg:col-span-1">
          <IndustryIntel rows={intel} />
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Niche radar                                                                 */
/* -------------------------------------------------------------------------- */

interface TrendObservation {
  _id: string;
  observation: string;
  evidence: ReadonlyArray<{ kind: string; ref: string; fact: string }>;
  relevanceScore: number;
  observedAt: number;
}

function NicheRadar({ rows }: { rows: ReadonlyArray<TrendObservation> | undefined }) {
  if (rows === undefined) return <ListSkeleton />;

  if (rows.length === 0) {
    return (
      <Section eyebrow="§01 · Niche radar" title="">
        <EmptyCard
          title="Quiet niche today."
          body="Maya scans your niche at 6pm in your timezone. Nothing she found cleared the relevance bar — better silence than noise."
        />
      </Section>
    );
  }

  return (
    <Section
      eyebrow="§01 · Niche radar"
      title=""
      rightSlot={
        <span className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
          {rows.length} observation{rows.length === 1 ? "" : "s"}
        </span>
      }
    >
      <ul className="space-y-3">
        {rows.map((row) => (
          <li
            key={row._id}
            className="rounded-2xl border border-[var(--hairline-strong)] bg-ink-2 p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-relaxed text-paper">
                  {row.observation}
                </p>
              </div>
              <RelevanceBadge score={row.relevanceScore} />
            </div>
            {row.evidence.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5 border-t border-[var(--hairline)] pt-3">
                {row.evidence.slice(0, 4).map((ev, i) => (
                  <EvidenceChip key={i} kind={ev.kind} fact={ev.fact} />
                ))}
              </div>
            )}
            <div className="mt-3 flex items-center justify-between font-mono text-[11px] uppercase tracking-widest text-paper-faint">
              <span>{timeAgo(row.observedAt)}</span>
              <button
                type="button"
                disabled
                className="inline-flex cursor-not-allowed items-center gap-1 text-paper-dim hover:text-paper"
                aria-label="Want a draft for this? (coming Sprint 5)"
              >
                <Sparkles className="h-3 w-3" />
                Want a draft?
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Competitor watch                                                            */
/* -------------------------------------------------------------------------- */

interface CompetitorObservation {
  _id: string;
  peerHandle: string;
  platform: string;
  observation: string;
  evidence: ReadonlyArray<{ kind: string; ref: string; fact: string }>;
  observedAt: number;
}

function CompetitorWatch({
  rows,
}: {
  rows: ReadonlyArray<CompetitorObservation> | undefined;
}) {
  if (rows === undefined) return <ListSkeleton />;

  if (rows.length === 0) {
    return (
      <Section eyebrow="§02 · Competitors" title="">
        <EmptyCard
          title="No peers watched yet."
          body="Pro adds 5 named competitor slots, Studio adds 10. Add peers from Profile and Maya watches them daily at 9am."
        />
      </Section>
    );
  }

  // Group observations by peer handle so each peer gets one card.
  const byPeer = new Map<string, CompetitorObservation[]>();
  for (const row of rows) {
    const list = byPeer.get(row.peerHandle) ?? [];
    list.push(row);
    byPeer.set(row.peerHandle, list);
  }

  return (
    <Section
      eyebrow="§02 · Competitors"
      title=""
      rightSlot={
        <span className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
          {byPeer.size} peer{byPeer.size === 1 ? "" : "s"}
        </span>
      }
    >
      <ul className="space-y-3">
        {[...byPeer.entries()].map(([peer, observations]) => (
          <li
            key={peer}
            className="rounded-2xl border border-[var(--hairline-strong)] bg-ink-2 p-5"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-display text-xl text-paper">@{peer}</p>
                <p className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
                  {observations[0].platform}
                </p>
              </div>
              <span className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
                {observations.length} move{observations.length === 1 ? "" : "s"}
              </span>
            </div>
            <ul className="mt-3 space-y-2 border-t border-[var(--hairline)] pt-3">
              {observations.slice(0, 3).map((obs) => (
                <li
                  key={obs._id}
                  className="flex items-start gap-3 text-sm text-paper-dim"
                >
                  <span
                    aria-hidden
                    className="mt-2 h-1 w-3 shrink-0 bg-lime"
                  />
                  <span className="flex-1">
                    {obs.observation}
                    <span className="ml-2 font-mono text-[10px] uppercase tracking-widest text-paper-faint">
                      {timeAgo(obs.observedAt)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 font-mono text-[11px] uppercase tracking-widest text-paper-faint">
              Worth borrowing? Maya cites the specific post — you decide.
            </p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Collab matches                                                              */
/* -------------------------------------------------------------------------- */

interface CollabMatch {
  _id: string;
  peerHandle: string;
  platform: string;
  surfacedAt: number;
}

function CollabMatches({
  rows,
}: {
  rows: ReadonlyArray<CollabMatch> | undefined;
}) {
  if (rows === undefined) return <ListSkeleton />;

  if (rows.length === 0) {
    return (
      <Section eyebrow="§03 · Collabs" title="">
        <EmptyCard
          title="No collab matches yet."
          body="The matchmaker is Pro+. Maya proposes peer creators in your niche with audience overlap and suggests a first DM you can edit and send yourself."
        />
      </Section>
    );
  }

  return (
    <Section
      eyebrow="§03 · Collabs"
      title=""
      rightSlot={
        <span className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
          {rows.length} match{rows.length === 1 ? "" : "es"}
        </span>
      }
    >
      <ul className="space-y-3">
        {rows.map((m) => (
          <li
            key={m._id}
            className="rounded-2xl border border-[var(--hairline-strong)] bg-ink-2 p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-display text-xl text-paper">@{m.peerHandle}</p>
                <p className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
                  {m.platform} · surfaced {timeAgo(m.surfacedAt)}
                </p>
              </div>
              <a
                // Maya never DMs on the creator's behalf — link out to the
                // platform DM surface so the creator sends it themselves.
                href={dmLinkFor(m.platform, m.peerHandle)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full bg-lime px-3 py-1.5 text-xs text-ink hover:bg-lime-soft"
              >
                Send DM
                <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-paper-dim">
              First message draft will land here once the matchmaker writes
              one for this peer — for now, open the DM and reference one of
              their recent posts.
            </p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Industry intel sidebar                                                      */
/* -------------------------------------------------------------------------- */

function IndustryIntel({
  rows,
}: {
  rows: ReadonlyArray<TrendObservation> | undefined;
}) {
  return (
    <Section eyebrow="§04 · Industry" title="Today's read">
      {rows === undefined ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 rounded-xl bg-ink-2" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyCard
          title="Quiet day."
          body="Industry intel is Pro+. Maya watches Tubefilter, Modern Retail, Marketing Brew, Adweek, Digiday and creator-econ newsletters daily."
        />
      ) : (
        <ul className="space-y-3">
          {rows.slice(0, 8).map((row) => {
            const link = row.evidence.find((e) => e.kind === "article");
            const inner = (
              <div className="rounded-2xl border border-[var(--hairline-strong)] bg-ink-2 p-4 transition-colors hover:bg-ink-3">
                <div className="flex items-center gap-2">
                  <Newspaper className="h-3.5 w-3.5 text-lime" />
                  <span className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
                    {timeAgo(row.observedAt)}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-paper">
                  {row.observation}
                </p>
                {link && (
                  <p className="mt-2 truncate font-mono text-[10px] uppercase tracking-widest text-paper-faint">
                    {link.fact}
                  </p>
                )}
              </div>
            );
            return (
              <li key={row._id}>
                {link ? (
                  <a href={link.ref} target="_blank" rel="noreferrer">
                    {inner}
                  </a>
                ) : (
                  inner
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Sub-components                                                              */
/* -------------------------------------------------------------------------- */

function RelevanceBadge({ score }: { score: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, score)) * 100);
  const tier = score >= 0.7 ? "high" : score >= 0.4 ? "med" : "low";
  const styles: Record<typeof tier, string> = {
    high: "bg-lime text-ink",
    med: "bg-ink-3 text-paper-dim border border-[var(--hairline-strong)]",
    low: "bg-ink-3 text-paper-faint border border-[var(--hairline)]",
  };
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ${styles[tier]}`}
    >
      {pct}% fit
    </span>
  );
}

function EvidenceChip({ kind, fact }: { kind: string; fact: string }) {
  const trimmed = fact.length > 48 ? `${fact.slice(0, 48)}…` : fact;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--hairline-strong)] bg-ink-3 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-paper-dim">
      <span className="text-lime">·</span>
      {kind} {trimmed}
    </span>
  );
}

function EmptyCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--hairline-strong)] bg-ink-2/40 p-6 sm:p-8">
      <p className="font-display text-xl text-paper">{title}</p>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-paper-dim">
        {body}
      </p>
    </div>
  );
}

function ListSkeleton() {
  return (
    <Section eyebrow="" title="">
      <ul className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <li key={i} className="h-28 rounded-2xl bg-ink-2" />
        ))}
      </ul>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function timeAgo(ts: number): string {
  const diffMin = Math.max(1, Math.round((Date.now() - ts) / 60_000));
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

/**
 * Best-effort DM deep link per platform. Maya never DMs on the creator's
 * behalf — these are just "open the right DM" shortcuts. Falls back to the
 * profile URL if the platform doesn't have a direct-message intent URL.
 */
function dmLinkFor(platform: string, handle: string): string {
  const cleanHandle = handle.replace(/^@/, "");
  switch (platform.toLowerCase()) {
    case "instagram":
      return `https://ig.me/m/${encodeURIComponent(cleanHandle)}`;
    case "x":
    case "twitter":
      return `https://x.com/messages/compose?recipient_id=${encodeURIComponent(cleanHandle)}`;
    case "tiktok":
      return `https://www.tiktok.com/@${encodeURIComponent(cleanHandle)}`;
    case "linkedin":
      return `https://www.linkedin.com/in/${encodeURIComponent(cleanHandle)}/`;
    case "youtube":
      return `https://www.youtube.com/@${encodeURIComponent(cleanHandle)}`;
    default:
      return `https://${encodeURIComponent(platform)}.com/${encodeURIComponent(cleanHandle)}`;
  }
}
