"use client";

/**
 * W3.2 / W3.4 — the grounded-reasoning body of the Thinking view. Renders
 * Maya's STATE OF KNOWLEDGE (foundation tables) as Observation → Insight →
 * Decision cards with verbatim buyer quotes + clickable source chips —
 * categorically different from the time-bucketed live pulse below it.
 *
 * Reads getMyFoundationInsights (W3.1). productPicture is read defensively
 * (a local shape) so this stays decoupled from W1; it lights up once W1's
 * inspector populates gtmApps.diagnosis.picture.
 */

import Link from "next/link";
import { Section, Card, Pill, ExtLink } from "../_components";
import type { FoundationInsights as FoundationInsightsData } from "@/convex/gtmMaya/missionControl";

type PictureLike = {
  promise?: string;
  whatItDoes?: string;
  whoItsFor?: string;
  differentiator?: string;
  category?: string;
  competitors?: string[];
  confidence?: "high" | "medium" | "low";
  gaps?: string[];
  sources?: string[];
};

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function SourceChip({ url }: { url: string }) {
  if (!/^https?:\/\//.test(url)) return null;
  return (
    <ExtLink href={url}>
      <span className="rounded bg-paper-faint/10 px-1.5 py-0.5 font-mono text-[11px] text-paper-dim">
        {host(url)} ↗
      </span>
    </ExtLink>
  );
}

function Quote({ text, url }: { text: string; url?: string }) {
  return (
    <div className="mt-2 border-l-2 border-lime/40 pl-3">
      <p className="text-sm italic text-paper-dim">“{text}”</p>
      {url ? (
        <div className="mt-1">
          <SourceChip url={url} />
        </div>
      ) : null}
    </div>
  );
}

function FitBar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 font-mono text-[11px] uppercase tracking-wide text-paper-faint">
        {label}
      </span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-paper-faint/10">
        <div className="h-full rounded-full bg-lime/60" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 shrink-0 text-right font-mono text-[11px] text-paper-dim">
        {pct}%
      </span>
    </div>
  );
}

function ProductCard({ picture }: { picture: PictureLike }) {
  const tone =
    picture.confidence === "high"
      ? "lime"
      : picture.confidence === "low"
        ? "rose"
        : "paper";
  return (
    <Section title="What I understand you do">
      <Card>
        <div className="flex items-start justify-between gap-4">
          <p className="text-base text-paper">
            {picture.promise || "Building my picture of your product…"}
          </p>
          {picture.confidence ? (
            <Pill tone={tone}>{picture.confidence} confidence</Pill>
          ) : null}
        </div>
        {picture.differentiator ? (
          <p className="mt-2 text-sm text-paper-dim">
            <span className="text-paper-faint">Your wedge — </span>
            {picture.differentiator}
          </p>
        ) : null}
        {picture.gaps && picture.gaps.length > 0 ? (
          <p className="mt-2 text-xs text-paper-faint">
            Still verifying: {picture.gaps.slice(0, 3).join("; ")}
          </p>
        ) : null}
        <div className="mt-3 border-t border-paper-faint/15 pt-3">
          <Link
            href="/clawlaunch/mission/account"
            className="font-mono text-[11px] uppercase tracking-wide text-paper-dim hover:text-paper"
          >
            Correct what I got wrong →
          </Link>
        </div>
      </Card>
    </Section>
  );
}

export function FoundationInsights({ data }: { data: FoundationInsightsData }) {
  const picture = data.productPicture as PictureLike | null;
  if (!data.hasFoundation && !picture) return null;

  return (
    <div className="mb-8 space-y-6">
      {picture ? <ProductCard picture={picture} /> : null}

      {data.buyer ? (
        <Section title="Your buyer">
          <Card>
            <p className="text-sm text-paper">{data.buyer.icpDescription}</p>
            {data.buyer.journeyStages.length > 0 ? (
              <div className="mt-3 space-y-3 border-t border-paper-faint/15 pt-3">
                {data.buyer.journeyStages.map((s, i) => (
                  <div key={i}>
                    <div className="flex items-center gap-2">
                      <Pill>{s.stage}</Pill>
                      <span className="text-sm text-paper-dim">
                        {s.whereTheyHangOut}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-paper-faint">
                      Intent signal: “{s.intentLanguage}”
                    </p>
                    {s.complaints.slice(0, 2).map((c, j) => (
                      <Quote key={j} text={c} />
                    ))}
                  </div>
                ))}
              </div>
            ) : null}
            {data.buyer.trustedVoices.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5 border-t border-paper-faint/15 pt-3">
                <span className="font-mono text-[11px] uppercase tracking-wide text-paper-faint">
                  Trusts
                </span>
                {data.buyer.trustedVoices.map((v, i) => (
                  <Pill key={i}>
                    {v.handle} · {v.platform}
                  </Pill>
                ))}
              </div>
            ) : null}
          </Card>
        </Section>
      ) : null}

      {data.competitors.length > 0 ? (
        <Section title="Who you compete with + your wedge" count={data.competitors.length}>
          <div className="space-y-2">
            {data.competitors.map((c, i) => (
              <Card key={i}>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-paper">{c.name}</span>
                  <Pill tone={c.kind === "direct" ? "rose" : "paper"}>{c.kind}</Pill>
                  {c.pricing ? (
                    <span className="font-mono text-[11px] text-paper-faint">
                      {c.pricing}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-paper-dim">{c.positioning}</p>
                {c.complaints.slice(0, 1).map((q, j) => (
                  <Quote key={j} text={q.quote} url={q.sourceUrl} />
                ))}
                {c.vulnerabilities.length > 0 ? (
                  <p className="mt-2 text-xs text-paper-faint">
                    Your opening: {c.vulnerabilities.slice(0, 3).join("; ")}
                  </p>
                ) : null}
              </Card>
            ))}
          </div>
        </Section>
      ) : null}

      {data.channels.length > 0 ? (
        <Section title="Why these channels" count={data.channels.length}>
          <div className="space-y-2">
            {data.channels.map((c, i) => (
              <Card key={i}>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-paper">{c.channel}</span>
                  {c.bet ? <Pill tone="lime">bet</Pill> : <Pill>parked</Pill>}
                </div>
                <p className="mt-1 text-sm text-paper-dim">{c.uniqueUnlock}</p>
                <div className="mt-2 space-y-1">
                  <FitBar label="audience" value={c.audienceFit} />
                  <FitBar label="cadence" value={c.cadenceFit} />
                </div>
              </Card>
            ))}
          </div>
        </Section>
      ) : null}

      {data.angles.length > 0 ? (
        <Section title="Angles I'll use" count={data.angles.length}>
          <div className="space-y-2">
            {data.angles.map((a, i) => (
              <Card key={i}>
                <p className="text-sm text-paper">{a.angle}</p>
                <Quote text={a.painQuote} url={a.painSourceUrl} />
                {a.hookVariants.length > 0 ? (
                  <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-paper-dim">
                    {a.hookVariants.slice(0, 3).map((h, j) => (
                      <li key={j}>{h}</li>
                    ))}
                  </ul>
                ) : null}
              </Card>
            ))}
          </div>
        </Section>
      ) : null}
    </div>
  );
}
