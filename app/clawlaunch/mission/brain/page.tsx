"use client";

/**
 * Brain — a dossier, not a document. Her model of the business as an
 * intelligence file, every module grounded in foundation rows:
 *
 *   DOSSIER   the buyer as a persona card — gist, verbatim facts, venues.
 *   BETS      channel bets as scored instruments — SVG fit ring (audience
 *             fit), warmth stepper (channelWarmthJson), one-line why.
 *   EVIDENCE  verbatim complaints as a pull-quote rail, sources tappable.
 *   ANGLES    the playbook as a status board (hook counts — real data).
 *   VOICE     trait chips + two exemplars, as she learned it.
 *   RULES     standing instructions as switch-rows + add input.
 *   WATCH     competitor rows, weakness-first.
 *
 * Grounded or hidden: a module without real rows doesn't render.
 */

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  Chip,
  channelColor,
  channelLabel,
  Empty,
  Loading,
  monoDate,
  NeedsOnboarding,
  Panel,
  Rise,
  Shell,
  SrcLink,
} from "../_components";

/* ── Warmth (channelWarmthJson on the agent row) ───────────────────────── */

type WarmthEntry = { state?: string };

function parseWarmth(json: string | undefined): Record<string, WarmthEntry> {
  if (!json) return {};
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, WarmthEntry>;
    }
  } catch {
    // fall through
  }
  return {};
}

const WARMTH_STEPS: Record<
  string,
  { hits: number; label: string; blocked?: boolean }
> = {
  new_needs_warmup: { hits: 1, label: "NEW" },
  warming: { hits: 2, label: "WARMING" },
  ready: { hits: 3, label: "READY" },
  warm: { hits: 3, label: "WARM" },
  restricted: { hits: 0, label: "RESTRICTED", blocked: true },
};

function Warmth({ state }: { state: string | undefined }) {
  const w = state ? WARMTH_STEPS[state] : undefined;
  if (!w) return null;
  return (
    <div
      className="mc-warmth"
      role="img"
      aria-label={`warmth: ${w.label.toLowerCase()}`}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={`step ${w.blocked ? "blocked" : i < w.hits ? "hit" : ""}`}
        />
      ))}
      <span className="wl">{w.label}</span>
    </div>
  );
}

/* ── Fit ring ──────────────────────────────────────────────────────────── */

const RING_C = 2 * Math.PI * 24; // r=24

function FitRing({
  value,
  color,
  label,
}: {
  value: number;
  color: string;
  label: string;
}) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <svg
      className="mc-fitring"
      width="58"
      height="58"
      viewBox="0 0 58 58"
      role="img"
      aria-label={`${label} fit ${pct}%`}
    >
      <circle
        cx="29"
        cy="29"
        r="24"
        fill="none"
        stroke="var(--mc-line)"
        strokeWidth="5"
      />
      <circle
        cx="29"
        cy="29"
        r="24"
        fill="none"
        stroke={color}
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={`${((pct / 100) * RING_C).toFixed(1)} ${RING_C.toFixed(1)}`}
        transform="rotate(-90 29 29)"
      />
      <text
        x="29"
        y="33"
        textAnchor="middle"
        fill="var(--paper)"
        fontSize="13"
        fontWeight="700"
        className="mc-num"
      >
        {pct}%
      </text>
    </svg>
  );
}

/* ── Voice heuristics — defensive read of the voiceProfileJson blob ────── */

function voiceParts(voice: unknown): { traits: string[]; exemplars: string[] } {
  const traits: string[] = [];
  const exemplars: string[] = [];
  const eat = (s: string) => {
    const t = s.trim();
    if (!t) return;
    if (t.length <= 32 && traits.length < 6) traits.push(t);
    else if (t.length > 32 && exemplars.length < 2) exemplars.push(t);
  };
  if (voice && typeof voice === "object" && !Array.isArray(voice)) {
    for (const v of Object.values(voice as Record<string, unknown>)) {
      if (typeof v === "string") eat(v);
      else if (Array.isArray(v)) {
        for (const x of v) if (typeof x === "string") eat(x);
      }
    }
  }
  return { traits, exemplars };
}

/* ── Page ──────────────────────────────────────────────────────────────── */

export default function BrainPage() {
  const snapshot = useQuery(api.gtmMaya.researchLifecycle.getMyGtmSnapshot);
  const insights = useQuery(api.gtmMaya.missionControl.getMyFoundationInsights);
  const competitors = useQuery(api.gtmMaya.missionControl.getMyCompetitiveMap);

  if (
    snapshot === undefined ||
    insights === undefined ||
    competitors === undefined
  )
    return <Loading />;
  if (snapshot === null) return <NeedsOnboarding />;

  const buyer = insights.buyer;
  const venues = buyer
    ? [
        ...new Set(
          buyer.journeyStages.map((s) => s.whereTheyHangOut).filter(Boolean),
        ),
      ].slice(0, 5)
    : [];
  const facts: Array<{ k: string; v: string }> = [];
  if (buyer) {
    const firstComplaint = buyer.journeyStages.flatMap((s) => s.complaints)[0];
    if (firstComplaint)
      facts.push({ k: "Pain, verbatim", v: `“${firstComplaint}”` });
    const intent = buyer.journeyStages
      .map((s) => s.intentLanguage)
      .find(Boolean);
    if (intent) facts.push({ k: "Intent signal", v: `“${intent}”` });
    const trusted = buyer.trustedVoices[0];
    if (trusted)
      facts.push({ k: "Trusts", v: `${trusted.handle} · ${trusted.platform}` });
  }

  const warmth = parseWarmth(snapshot.agent.channelWarmthJson);
  const bets = insights.channels.filter((c) => c.bet).slice(0, 3);

  const quotes = insights.angles
    .filter((a) => a.painQuote)
    .filter(
      (a, i, arr) => arr.findIndex((b) => b.painQuote === a.painQuote) === i,
    )
    .slice(0, 4);

  const angles = insights.angles.slice(0, 8);
  const { traits, exemplars } = voiceParts(insights.voice);
  const comps = (competitors ?? []).slice(0, 5);

  const hasModel =
    Boolean(buyer) ||
    bets.length > 0 ||
    quotes.length > 0 ||
    angles.length > 0 ||
    traits.length > 0;

  return (
    <Shell
      title="Brain"
      when={
        insights.synthesizedAt
          ? `FOUNDATION LOCKED · ${monoDate(insights.synthesizedAt)}`
          : undefined
      }
    >
      {!hasModel ? (
        <Rise>
          <div className="mb-3.5">
            <Empty
              title="Research in progress"
              body="Her model of your buyer, channels, and angles fills in after the first research pass."
            />
          </div>
        </Rise>
      ) : null}

      <div className="mc-grid mc-brain-grid">
        {/* ── Dossier ───────────────────────────────────────────────────── */}
        {buyer ? (
          <Rise className="mc-a-dossier">
            <Panel title="Who she believes is buying" raised className="h-full">
              <div className="mc-persona">
                <div className="mc-glyph">
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    strokeWidth="1.7"
                  >
                    <circle cx="12" cy="8" r="3.4" />
                    <path d="M5 20c1.2-3.4 3.8-5 7-5s5.8 1.6 7 5" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <div className="mc-persona-gist !mt-0 text-[13px] font-semibold text-paper">
                    {buyer.icpDescription}
                  </div>
                </div>
              </div>
              {facts.length > 0 ? (
                <div className="mc-facts">
                  {facts.map((f) => (
                    <div key={f.k} className="mc-fact">
                      <div className="k">{f.k}</div>
                      <div className="v">{f.v}</div>
                    </div>
                  ))}
                </div>
              ) : null}
              {venues.length > 0 ? (
                <div className="mc-venues">
                  {venues.map((v) => (
                    <Chip key={v}>{v}</Chip>
                  ))}
                </div>
              ) : null}
            </Panel>
          </Rise>
        ) : null}

        {/* ── Bets ──────────────────────────────────────────────────────── */}
        {bets.length > 0 ? (
          <Rise i={1} className="mc-a-bets">
            <Panel title="Where she's betting, and why" className="h-full">
              {bets.map((c, i) => (
                <div key={c.channel} className="mc-bet">
                  <FitRing
                    value={c.audienceFit}
                    color={channelColor(c.channel)}
                    label={channelLabel(c.channel)}
                  />
                  <div className="min-w-0">
                    <Chip platform={c.channel}>
                      {channelLabel(c.channel)} · bet #{i + 1}
                    </Chip>
                    {c.uniqueUnlock ? (
                      <div className="mc-why">{c.uniqueUnlock}</div>
                    ) : null}
                    <Warmth state={warmth[c.channel]?.state} />
                  </div>
                </div>
              ))}
            </Panel>
          </Rise>
        ) : null}

        {/* ── Evidence ──────────────────────────────────────────────────── */}
        {quotes.length > 0 ? (
          <Rise i={2} className="mc-a-quotes">
            <Panel title="The evidence · in their words">
              <div className="mc-quote-rail">
                {quotes.map((q, i) => (
                  <div key={i} className="mc-pull">
                    <p>{q.painQuote}</p>
                    <div className="from">
                      <span />
                      <SrcLink href={q.painSourceUrl}>source ↗</SrcLink>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          </Rise>
        ) : null}

        {/* ── Angles ────────────────────────────────────────────────────── */}
        {angles.length > 0 ? (
          <Rise i={3} className="mc-a-angles">
            <Panel title="Content angles · the playbook">
              <div className="mc-angle-grid">
                {angles.map((a, i) => (
                  <div key={i} className="mc-angle">
                    <span className="t">{a.angle}</span>
                    {a.hookVariants.length > 0 ? (
                      <span className="n">{a.hookVariants.length} hooks</span>
                    ) : null}
                  </div>
                ))}
              </div>
            </Panel>
          </Rise>
        ) : null}

        {/* ── Voice ─────────────────────────────────────────────────────── */}
        {traits.length > 0 || exemplars.length > 0 ? (
          <Rise i={4} className="mc-a-voice">
            <Panel title="Your voice, as she learned it" className="h-full">
              {traits.length > 0 ? (
                <div className="mc-traits">
                  {traits.map((t) => (
                    <span key={t} className="mc-chip">
                      {t}
                    </span>
                  ))}
                </div>
              ) : null}
              {exemplars.map((e, i) => (
                <div key={i} className="mc-exemplar">
                  “{e}”
                </div>
              ))}
            </Panel>
          </Rise>
        ) : null}

        {/* ⚠️ The "Standing instructions" panel lived here and was REMOVED
            2026-08-12. It read `gtmMaya.steering.listMySteeringDirectives` —
            the frozen product's `gtmSteeringDirectives` table — while the live
            module writes founder directives to `directives`. So a rule given
            to Maya today was never going to appear in it, and anything it did
            show came from a system that no longer runs.

            House Rules is now its own top-level screen (§16.2), backed by
            `maya.directives.myHouseRules`, and it is the only place rules are
            shown. Two screens, one of them stale, is worse than one. */}

        {/* ── Competitor watch ──────────────────────────────────────────── */}
        {comps.length > 0 ? (
          <Rise i={6} className="mc-a-watch">
            <Panel title="Competitor watch" className="h-full">
              {comps.map((c) => (
                <div key={c._id} className="mc-comp">
                  <div className="min-w-0">
                    <div className="who">{c.competitorName}</div>
                    <div className="what">
                      {c.vulnerabilities[0] ?? c.positioning}
                    </div>
                  </div>
                  {c.url ? <SrcLink href={c.url}>↗</SrcLink> : null}
                </div>
              ))}
            </Panel>
          </Rise>
        ) : null}
      </div>
    </Shell>
  );
}
