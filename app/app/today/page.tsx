"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import Link from "next/link";

function ago(ts: number): string {
  const h = Math.round((Date.now() - ts) / 3_600_000);
  return h < 1 ? "just now" : h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

export default function TodayPage() {
  const t = useQuery(api.ui.today);
  if (t === undefined) return <p className="opacity-60 text-sm">loading…</p>;
  if (t === null) return <p className="text-sm">No account yet. <Link className="underline" href="/start">Start here.</Link></p>;
  return (
    <div className="flex flex-col gap-6">
      <section>
        <h1 className="text-lg font-semibold">Today</h1>
        <p className="text-sm opacity-80 mt-1">{t.statusLine}</p>
        {!t.paired && <Link className="btn mt-3 inline-flex" href="/telegram">Connect Telegram</Link>}
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-wide opacity-50">What she sent today</h2>
        {t.sentToday.length === 0 ? (
          <p className="text-sm opacity-60 mt-2">Nothing yet. She only texts when there is something worth your time.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-3">
            {t.sentToday.map((m) => (
              <li key={m.id} className="border border-white/10 rounded-2xl rounded-bl-sm px-4 py-3 text-sm">
                <div className="text-[11px] uppercase tracking-wide opacity-50 mb-1">{m.kind} · {ago(m.ts)}{m.error ? ` · not delivered: ${m.error}` : ""}</div>
                <p className="whitespace-pre-wrap">{m.body}</p>
                {m.links.length > 0 && <div className="mt-2 flex flex-col gap-1">{m.links.map((l) => <a key={l} className="underline break-all text-xs" href={l} target="_blank" rel="noreferrer">{l}</a>)}</div>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-wide opacity-50">Next filming block</h2>
        <p className="text-sm opacity-80 mt-2">{t.nextBlock ? `${t.nextBlock.title} · ${new Date(t.nextBlock.start).toLocaleString()}${t.nextBlock.status === "proposed" ? " · waiting for your yes" : ""}` : "None planned yet. She proposes one when something on your calendar is worth filming around."}</p>
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-wide opacity-50">Your recent posts</h2>
        {t.week.length === 0 ? (
          <p className="text-sm opacity-60 mt-2">{t.dossier ? "No posts read yet." : "She is reading your posts now."}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {t.week.map((p) => (
              <li key={p.id} className="flex items-center justify-between text-sm border-b border-white/5 py-2">
                <a className="underline truncate max-w-[60%]" href={p.url} target="_blank" rel="noreferrer">{p.platform} · {new Date(p.createTime).toLocaleDateString()}</a>
                <span className="tabular-nums opacity-80">{p.views.toLocaleString()} views{p.multiple !== null ? ` · ${p.multiple}×` : ""}</span>
              </li>
            ))}
          </ul>
        )}
        {t.week[0] && <p className="text-[11px] opacity-40 mt-1">numbers as of {ago(t.week[0].metricsAsOf)}</p>}
      </section>
    </div>
  );
}
