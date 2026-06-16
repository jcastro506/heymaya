"use client";

/**
 * Decision timeline — the literal record of Maya deciding.
 *
 * Where the "Live pulse" below shows Maya's optional, hand-written
 * post_activity narration, THIS shows her RAW tool calls (gtmAgentTrace),
 * auto-emitted by the plugin so nothing is skipped or embellished: every
 * channel she read, post she drafted, thing she published, grounded in the
 * real call with its key argument, outcome, and latency. Rows are grouped
 * into time-gap "work sessions" so it reads like watching her work a shift,
 * not a flat log. This is the answer to "show me what the agent is actually
 * thinking and deciding."
 */

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Empty } from "../_components";

type Category =
  | "research"
  | "draft"
  | "publish"
  | "foundation"
  | "read"
  | "other";
type Status = "ok" | "blocked" | "failed" | "error";

type TraceRow = {
  _id: string;
  tool: string;
  category: Category;
  argsSummary?: string;
  resultSummary?: string;
  status: Status;
  latencyMs?: number;
  ts: number;
};

type Range = "hour" | "day" | "week";

const RANGE_MS: Record<Range, number> = {
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
};

// A gap longer than this between consecutive calls starts a new "work
// session" — the natural unit a cron wake / inbound turn produces.
const SESSION_GAP_MS = 4 * 60 * 1000;

const CAT_META: Record<Category, { label: string; dot: string; text: string }> =
  {
    research: { label: "Research", dot: "bg-sky-300", text: "text-sky-300" },
    draft: { label: "Draft", dot: "bg-amber-300", text: "text-amber-300" },
    publish: { label: "Publish", dot: "bg-lime", text: "text-lime" },
    foundation: {
      label: "Strategy",
      dot: "bg-violet-300",
      text: "text-violet-300",
    },
    read: { label: "Check", dot: "bg-paper/40", text: "text-paper-dim" },
    other: { label: "Step", dot: "bg-paper/25", text: "text-paper-faint" },
  };

// Plain-language verb per tool. Falls back to a humanized tool name so a
// newly-added tool still reads sensibly without a code change here.
const TOOL_VERB: Record<string, string> = {
  search_web: "Searched the web",
  search_demand: "Checked search demand",
  research_reddit: "Read Reddit",
  research_reddit_comments: "Read a Reddit thread",
  research_x: "Read X",
  research_x_thread: "Read an X thread",
  research_x_competitor_mentions: "Scanned X for competitor mentions",
  research_x_engaged_audience: "Studied an X audience",
  research_x_user_timeline: "Read an X timeline",
  research_hn: "Read Hacker News",
  research_hn_item: "Read an HN thread",
  research_tiktok: "Read TikTok",
  research_youtube: "Read YouTube",
  research_instagram: "Read Instagram",
  research_linkedin: "Read LinkedIn",
  research_video_comments: "Read video comments",
  research_video_transcript: "Read a video transcript",
  competitor_ads: "Studied competitor ads",
  bio_funnel: "Inspected a bio funnel",
  scrape_creators: "Pulled profile data",
  save_target_thread: "Saved a target thread",
  save_target_account: "Saved a target account",
  save_draft: "Drafted a post",
  update_draft_voice_match: "Voice-matched a draft",
  generate_slide_image: "Made a slide",
  review_media: "Reviewed media",
  make_ad_from_url: "Started a video",
  clone_winning_ad: "Started a video from a winner",
  propose_calendar: "Built a plan",
  approve_calendar: "Approved the plan",
  save_foundation_buyer_map: "Mapped your buyer",
  save_foundation_competitor: "Logged a competitor",
  save_foundation_channel_scorecard: "Scored a channel",
  save_foundation_content_angle: "Saved a content angle",
  save_foundation_relationship_target: "Saved a relationship target",
  set_north_star: "Set the North Star",
  set_strategy_approval: "Updated strategy status",
  save_voice_profile: "Captured your voice",
  save_style_exemplars: "Saved voice examples",
  set_channel_warmth: "Advanced channel warmth",
  save_competitor_move: "Logged a competitor move",
  save_niche_pulse_signal: "Logged a niche signal",
  save_learning: "Saved a learning",
  save_diagnosis: "Saved a diagnosis",
  post_to_channel: "Posted",
  publish_draft: "Published a post",
  reply_to_comment: "Replied to a comment",
  send_media_to_user: "Sent you media",
  send_confirm_card: "Sent you a one-tap card",
};

function humanizeTool(tool: string): string {
  return tool.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

// Pull the single most meaningful argument out of the compact argsSummary
// JSON so each step shows a real, grounded detail (a subreddit, a query, the
// channel) rather than a blob.
const ARG_KEYS = [
  "query",
  "subreddit",
  "hashtag",
  "userName",
  "channel",
  "platform",
  "url",
  "title",
  "kind",
  "name",
  "text",
  "summary",
];

function argDetail(argsSummary?: string): string | null {
  if (!argsSummary) return null;
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(argsSummary) as Record<string, unknown>;
  } catch {
    // Truncated JSON (capped at write) — show a trimmed raw hint.
    const raw = argsSummary.replace(/^[{"]+/, "").slice(0, 60);
    return raw ? raw + "…" : null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  for (const k of ARG_KEYS) {
    const val = parsed[k];
    if (typeof val === "string" && val.trim()) {
      const v = val.trim();
      return v.length > 80 ? v.slice(0, 80) + "…" : v;
    }
  }
  return null;
}

const STATUS_META: Record<
  Status,
  { mark: string; cls: string; word: string }
> = {
  ok: { mark: "✓", cls: "text-lime", word: "" },
  blocked: { mark: "⊘", cls: "text-amber-300", word: "held" },
  failed: { mark: "✕", cls: "text-red-400", word: "failed" },
  error: { mark: "!", cls: "text-red-400", word: "errored" },
};

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function dayLabel(ms: number): string {
  return new Date(ms).toLocaleDateString([], {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

type Session = {
  startTs: number;
  endTs: number;
  rows: TraceRow[];
};

function describeSession(s: Session): string {
  const counts = new Map<Category, number>();
  for (const r of s.rows) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
  const order: Category[] = ["research", "draft", "publish", "foundation", "read"];
  const parts: string[] = [];
  for (const c of order) {
    const n = counts.get(c);
    if (!n) continue;
    const noun =
      c === "research"
        ? n === 1
          ? "read 1 source"
          : `read ${n} sources`
        : c === "draft"
          ? `drafted ${n}`
          : c === "publish"
            ? `published ${n}`
            : c === "foundation"
              ? `saved ${n} to strategy`
              : `${n} checks`;
    parts.push(noun);
  }
  return parts.join(" · ") || `${s.rows.length} steps`;
}

function Step({ row, live }: { row: TraceRow; live: boolean }) {
  const meta = CAT_META[row.category] ?? CAT_META.other;
  const verb = TOOL_VERB[row.tool] ?? humanizeTool(row.tool);
  const detail = argDetail(row.argsSummary);
  const st = STATUS_META[row.status] ?? STATUS_META.ok;
  return (
    <article className="relative pl-7">
      <span
        className={`absolute left-[-4.5px] top-[7px] size-[9px] rounded-full ring-4 ring-ink ${meta.dot} ${
          live ? "animate-pulse" : ""
        }`}
      />
      <div className="flex items-baseline gap-2">
        <span className="text-[14px] font-medium text-paper">{verb}</span>
        {detail ? (
          <span className={`font-mono text-[12px] ${meta.text} truncate`}>
            {detail}
          </span>
        ) : null}
      </div>
      <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-paper-faint">
        <span className={`uppercase tracking-[0.16em] ${meta.text}`}>
          {meta.label}
        </span>
        <span>{clock(row.ts)}</span>
        {row.status !== "ok" ? (
          <span className={st.cls}>
            {st.mark} {st.word}
          </span>
        ) : null}
        {typeof row.latencyMs === "number" && row.latencyMs > 0 ? (
          <span>{(row.latencyMs / 1000).toFixed(1)}s</span>
        ) : null}
        {live ? (
          <span className="rounded-full bg-lime/20 px-1.5 text-[9px] uppercase tracking-wide text-lime">
            live
          </span>
        ) : null}
      </div>
    </article>
  );
}

export function DecisionTimeline() {
  const [range, setRange] = useState<Range>("day");
  const sinceMs = useMemo(() => Date.now() - RANGE_MS[range], [range]);
  const trace = useQuery(api.gtmMaya.missionControl.getMyAgentTrace, {
    sinceMs,
    limit: 1000,
  }) as TraceRow[] | undefined;

  // Newest row → the live anchor.
  const liveId = trace && trace.length > 0 ? trace[0]._id : null;

  // Query returns newest-first; reverse to chronological, then split into
  // sessions on gaps. Each session reads oldest→newest like a real shift.
  const sessions = useMemo<Session[]>(() => {
    if (!trace || trace.length === 0) return [];
    const chrono = [...trace].sort((a, b) => a.ts - b.ts);
    const out: Session[] = [];
    let cur: Session | null = null;
    for (const r of chrono) {
      if (!cur || r.ts - cur.endTs > SESSION_GAP_MS) {
        cur = { startTs: r.ts, endTs: r.ts, rows: [r] };
        out.push(cur);
      } else {
        cur.rows.push(r);
        cur.endTs = r.ts;
      }
    }
    // Newest session first.
    return out.reverse();
  }, [trace]);

  return (
    <div className="mb-12">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-paper">
          Decision timeline
        </h2>
        <div className="h-px flex-1 bg-paper-faint/15" />
        <div className="inline-flex rounded-lg border border-paper-faint/15 bg-ink-2 p-0.5">
          {(["hour", "day", "week"] as Range[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`rounded-md px-3 py-1 font-mono text-[11px] uppercase tracking-wide transition-colors ${
                range === r
                  ? "bg-paper/10 text-paper"
                  : "text-paper-dim hover:text-paper"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <p className="mb-6 max-w-2xl text-[13px] text-paper-dim">
        Every call your manager actually made — read, judged, drafted, posted —
        as it happened. Grounded in the real work, not a summary.
      </p>

      {trace === undefined ? (
        <p className="font-mono text-xs text-paper-faint">Loading…</p>
      ) : sessions.length === 0 ? (
        <Empty
          title="No decisions in this window"
          body="As your manager researches, reasons, and posts, each move she makes streams in here live."
        />
      ) : (
        <div className="space-y-8">
          {sessions.map((s) => (
            <section
              key={s.startTs}
              className="rounded-lg border border-paper-faint/12 bg-ink-2/40 p-5"
            >
              <div className="mb-4">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[12px] text-paper">
                    {clock(s.startTs)}
                    {s.endTs > s.startTs ? `–${clock(s.endTs)}` : ""}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-wide text-paper-faint">
                    {dayLabel(s.startTs)} · {s.rows.length} steps
                  </span>
                </div>
                <p className="mt-1 text-[13px] text-paper-dim">
                  {describeSession(s)}
                </p>
              </div>
              <div className="relative space-y-5 border-l border-paper-faint/15">
                {s.rows.map((r) => (
                  <Step key={r._id} row={r} live={r._id === liveId} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
