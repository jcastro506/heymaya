"use client";

/**
 * Activity — watch her work. Two live views, one toggle:
 *
 *   Play-by-play — the narrated feed of what Maya is doing right now
 *                  (researching / found / drafted / posted / thinking),
 *                  newest first, grouped by day, sources tappable.
 *   Your chat    — a read-only mirror of the Telegram thread, so the web
 *                  receipt and the conversation never drift apart.
 *
 * Both are Convex live subscriptions: entries stream in as she works.
 */

import { useMemo, useState, type CSSProperties } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  Activity as ActivityIcon,
  Lightbulb,
  Map as MapIcon,
  MessageCircle,
  PenLine,
  Search,
  Send,
  Sparkles,
} from "lucide-react";
import {
  Card,
  clock,
  Empty,
  LiveDot,
  Loading,
  NeedsOnboarding,
  Shell,
  SourceChip,
} from "../_components";

type View = "feed" | "chat";

/* ── Play-by-play ──────────────────────────────────────────────────────── */

const KIND_META: Record<
  string,
  { label: string; icon: typeof Search; accent: boolean }
> = {
  researching: { label: "researching", icon: Search, accent: false },
  found: { label: "found", icon: Lightbulb, accent: true },
  drafted: { label: "drafted", icon: PenLine, accent: true },
  posted: { label: "posted", icon: Send, accent: true },
  thinking: { label: "thinking", icon: Sparkles, accent: false },
  plan_changed: { label: "plan", icon: MapIcon, accent: true },
  status: { label: "update", icon: ActivityIcon, accent: false },
};

type ActivityRow = {
  _id: string;
  kind: string;
  summary: string;
  detail?: string;
  linkedRef?: string;
  createdAt: number;
};

function dayLabel(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (ms >= today.getTime()) return "Today";
  if (ms >= today.getTime() - 24 * 60 * 60 * 1000) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

function groupByDay<T extends { ts: number }>(
  rows: T[]
): Array<{ key: string; label: string; rows: T[] }> {
  const groups: Array<{ key: string; label: string; rows: T[] }> = [];
  const byKey = new Map<string, (typeof groups)[number]>();
  for (const r of rows) {
    const d = new Date(r.ts);
    d.setHours(0, 0, 0, 0);
    const key = String(d.getTime());
    let g = byKey.get(key);
    if (!g) {
      g = { key, label: dayLabel(r.ts), rows: [] };
      byKey.set(key, g);
      groups.push(g);
    }
    g.rows.push(r);
  }
  return groups;
}

function FeedItem({ a, live, i }: { a: ActivityRow; live: boolean; i: number }) {
  const meta = KIND_META[a.kind] ?? KIND_META.status;
  const Icon = meta.icon;
  const sourceUrl =
    a.linkedRef && /^https?:\/\//.test(a.linkedRef) ? a.linkedRef : null;
  return (
    <li
      className="mc-rise relative pl-9"
      style={{ "--i": Math.min(i, 8) } as CSSProperties}
    >
      {/* node on the spine */}
      <span
        className={`absolute left-0 top-0.5 flex size-6 items-center justify-center rounded-full border ${
          meta.accent
            ? "border-lime/30 bg-lime/10 text-lime"
            : "border-paper-faint/20 bg-ink-2 text-paper-faint"
        }`}
      >
        <Icon className="size-3" />
      </span>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-dim">
          {meta.label}
        </span>
        <span className="font-mono text-[10px] tabular-nums text-paper-faint">
          {clock(a.createdAt)}
        </span>
        {live ? (
          <span className="rounded-full bg-lime/15 px-1.5 font-mono text-[9px] uppercase tracking-wide text-lime">
            live
          </span>
        ) : null}
      </div>
      <p className="mt-1 font-display text-[17px] italic leading-snug text-paper">
        {a.summary}
      </p>
      {a.detail ? (
        <p className="mt-1.5 whitespace-pre-line border-l border-paper-faint/20 pl-3 text-[13px] leading-relaxed text-paper-dim">
          {a.detail}
        </p>
      ) : null}
      {sourceUrl ? (
        <div className="mt-2">
          <SourceChip url={sourceUrl} />
        </div>
      ) : null}
    </li>
  );
}

/* ── Chat mirror ───────────────────────────────────────────────────────── */

type ChatRow = {
  _id: string;
  role: "user" | "maya";
  body: string;
  channel: string;
  ts: number;
};

function ChatBubble({ m }: { m: ChatRow }) {
  const isMaya = m.role === "maya";
  return (
    <li className={`flex ${isMaya ? "justify-start" : "justify-end"}`}>
      <div className={`max-w-[85%] ${isMaya ? "" : "text-right"}`}>
        <p
          className={`mb-1 font-mono text-[10px] uppercase tracking-[0.18em] ${
            isMaya ? "text-lime-soft" : "text-paper-faint"
          }`}
        >
          {isMaya ? "Maya" : "You"} · {clock(m.ts)}
        </p>
        <div
          className={`inline-block whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-left text-sm leading-relaxed ${
            isMaya
              ? "rounded-tl-md border border-paper-faint/15 bg-ink-2 text-paper"
              : "rounded-tr-md bg-lime/12 text-paper ring-1 ring-inset ring-lime/20"
          }`}
        >
          {m.body}
        </div>
      </div>
    </li>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────── */

export default function ActivityPage() {
  const snapshot = useQuery(api.gtmMaya.researchLifecycle.getMyGtmSnapshot);
  const activity = useQuery(api.gtmMaya.missionControl.getMyAgentActivity, {
    limit: 100,
  });
  const messages = useQuery(api.gtmMaya.missionControl.getMyMayaMessages, {});
  const [view, setView] = useState<View>("feed");

  const feedGroups = useMemo(
    () =>
      groupByDay(
        (activity ?? []).map((a) => ({ ...a, ts: a.createdAt }))
      ),
    [activity]
  );
  const chatGroups = useMemo(() => groupByDay(messages ?? []), [messages]);

  if (snapshot === undefined || activity === undefined) return <Loading />;
  if (snapshot === null) return <NeedsOnboarding />;

  const liveId =
    activity[0] && Date.now() - activity[0].createdAt < 10 * 60 * 1000
      ? activity[0]._id
      : null;

  return (
    <Shell
      title="Activity"
      status={
        <>
          <LiveDot />
          <span>Streaming live as she works.</span>
        </>
      }
    >
      {/* View toggle */}
      <div className="mc-rise mb-8 flex gap-1 rounded-full border border-paper-faint/20 bg-ink-2 p-1 sm:w-fit">
        {(
          [
            { key: "feed", label: "Play-by-play", icon: ActivityIcon },
            { key: "chat", label: "Your chat", icon: MessageCircle },
          ] as const
        ).map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => setView(v.key)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors sm:flex-none ${
              view === v.key ? "bg-paper text-ink" : "text-paper-dim hover:text-paper"
            }`}
          >
            <v.icon className="size-3.5" />
            {v.label}
          </button>
        ))}
      </div>

      {view === "feed" ? (
        feedGroups.length === 0 ? (
          <Empty
            title="Quiet for now"
            body="As Maya reads, reasons, drafts, and posts, her play-by-play streams in here live — with the receipts."
          />
        ) : (
          <div className="space-y-10">
            {feedGroups.map((g) => (
              <section key={g.key}>
                <div className="mb-4 flex items-center gap-3">
                  <h2 className="font-mono text-[11px] uppercase tracking-[0.22em] text-paper-faint">
                    {g.label}
                  </h2>
                  <div className="h-px flex-1 bg-paper-faint/10" />
                  <span className="font-mono text-[11px] tabular-nums text-paper-faint">
                    {g.rows.length}
                  </span>
                </div>
                <ol className="relative space-y-6 before:absolute before:inset-y-1 before:left-3 before:w-px before:bg-paper-faint/12">
                  {g.rows.map((a, i) => (
                    <FeedItem key={a._id} a={a} live={a._id === liveId} i={i} />
                  ))}
                </ol>
              </section>
            ))}
          </div>
        )
      ) : messages === undefined ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="mc-skeleton h-16 w-full" />
          ))}
        </div>
      ) : chatGroups.length === 0 ? (
        <Empty
          title="No messages mirrored yet"
          body="Your Telegram thread with Maya shows up here, read-only, as you two talk — so the receipt and the conversation never drift apart."
        />
      ) : (
        <div className="space-y-10">
          {chatGroups.map((g) => (
            <section key={g.key}>
              <div className="mb-4 flex items-center gap-3">
                <h2 className="font-mono text-[11px] uppercase tracking-[0.22em] text-paper-faint">
                  {g.label}
                </h2>
                <div className="h-px flex-1 bg-paper-faint/10" />
              </div>
              {/* Newest day first; within a day read top-down like a chat. */}
              <ol className="space-y-4">
                {[...g.rows].reverse().map((m) => (
                  <ChatBubble key={m._id} m={m} />
                ))}
              </ol>
            </section>
          ))}
          <p className="border-t border-paper-faint/15 pt-4 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
            Read-only mirror — reply in Telegram
          </p>
        </div>
      )}
    </Shell>
  );
}
