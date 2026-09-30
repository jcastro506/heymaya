"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * The idea taste test (operator only, the same token as /ops). One idea at a time, for the account
 * shown, with no hint of who wrote it: would they film it, and what's wrong with it. The ratings are
 * the golden set her ideas are scored against.
 */
export default function TastePage() {
  const [token] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    const q = new URLSearchParams(window.location.search).get("token");
    try {
      if (q) window.sessionStorage.setItem("ops_token", q);
      return q ?? window.sessionStorage.getItem("ops_token") ?? "";
    } catch {
      return q ?? "";
    }
  });
  const n = useQuery(api.eval.ideaTaste.next, token ? { token } : "skip");
  const rate = useMutation(api.eval.ideaTaste.rate);
  const [flags, setFlags] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [showResults, setShowResults] = useState(false);

  if (!token) return <p className="p-6 text-sm opacity-60">No token.</p>;
  if (n === undefined) return <p className="p-6 text-sm opacity-60">loading…</p>;
  if (n === null) return <p className="p-6 text-sm">Not authorized.</p>;

  async function submit(id: string, wouldFilm: boolean) {
    setBusy(true);
    await rate({ token, id: id as Id<"evalRuns">, wouldFilm, flags, note: note.trim() || undefined });
    setFlags([]);
    setNote("");
    setBusy(false);
    window.scrollTo({ top: 0 });
  }
  const toggle = (f: string) => setFlags((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]));
  const item = n.item;
  const handles = item ? [item.account.handles.tiktok && `TikTok @${item.account.handles.tiktok}`, item.account.handles.instagram && `Instagram @${item.account.handles.instagram}`].filter(Boolean).join(" · ") : "";

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-5 p-5 text-[15px]">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">Idea taste test</h1>
        <span className="text-xs tabular-nums opacity-60">{n.rated} of {n.total} rated</span>
      </header>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-violet-400" style={{ width: `${n.total ? (n.rated / n.total) * 100 : 0}%` }} /></div>

      {item ? (
        <>
          <section className="rounded-2xl border border-white/10 p-4">
            <p className="text-[11px] uppercase tracking-wide opacity-50">The account</p>
            <p className="mt-1 font-medium">{handles}</p>
            {item.account.summary ? <p className="mt-1 text-sm opacity-75">{item.account.summary}</p> : null}
            {item.account.themes?.length ? <p className="mt-1 text-xs opacity-50">{item.account.themes.join(" · ")}</p> : null}
          </section>

          <section className="rounded-2xl border border-violet-400/40 bg-violet-400/5 p-4">
            <p className="text-[11px] uppercase tracking-wide opacity-50">The idea they were texted</p>
            <p className="mt-2 whitespace-pre-wrap leading-relaxed">{item.text}</p>
            {item.evidence.length ? <p className="mt-3 text-xs opacity-60">Inspired by: {item.evidence.map((u) => <a key={u} className="mr-2 underline" href={u} target="_blank" rel="noreferrer">the post</a>)}</p> : null}
          </section>

          <section>
            <p className="mb-2 text-[11px] uppercase tracking-wide opacity-50">Anything wrong with it? (tap all that apply)</p>
            <div className="flex flex-wrap gap-2">
              {n.flags.map((f) => (
                <button key={f} onClick={() => toggle(f)} className={`rounded-full border px-3 py-1.5 text-sm ${flags.includes(f) ? "border-amber-300 bg-amber-300/15 text-amber-200" : "border-white/15 opacity-80"}`}>{f}</button>
              ))}
            </div>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why? (optional, a few words is plenty)" rows={2} className="mt-3 w-full rounded-xl border border-white/15 bg-transparent p-3 text-sm outline-none" />
          </section>

          <div className="sticky bottom-3 grid grid-cols-2 gap-3">
            <button disabled={busy} onClick={() => submit(item.id, false)} className="rounded-2xl border border-red-300/40 bg-red-300/10 py-4 font-semibold text-red-200 disabled:opacity-40">Wouldn’t film it</button>
            <button disabled={busy} onClick={() => submit(item.id, true)} className="rounded-2xl border border-emerald-300/40 bg-emerald-300/10 py-4 font-semibold text-emerald-200 disabled:opacity-40">Would film it</button>
          </div>
        </>
      ) : (
        <p className="rounded-2xl border border-white/10 p-5 text-sm opacity-80">{n.total === 0 ? "No ideas loaded yet." : "All rated. Thank you: that's the golden set."}</p>
      )}

      <button onClick={() => setShowResults((s) => !s)} className="self-start text-xs underline opacity-60">{showResults ? "Hide results" : "Show results so far (reveals who wrote what)"}</button>
      {showResults ? <Results token={token} /> : null}
    </main>
  );
}

function Results({ token }: { token: string }) {
  const r = useQuery(api.eval.ideaTaste.results, { token });
  if (!r) return null;
  const row = (name: string, s: NonNullable<typeof r>["maya"]) => (
    <tr><td className="py-1 pr-3 font-medium">{name}</td><td className="pr-3 tabular-nums">{s.rated}</td><td className="pr-3 tabular-nums">{s.wouldFilmPct}%</td><td className="pr-3 tabular-nums">{s.cleanPct}%</td><td className="pr-3 tabular-nums">{s.flags.cheesy}%</td><td className="pr-3 tabular-nums">{s.flags.generic}%</td><td className="pr-3 tabular-nums">{s.flags["sounds like AI"]}%</td><td className="tabular-nums">{s.judgeAgreesPct === null ? "—" : `${s.judgeAgreesPct}%`}</td></tr>
  );
  return (
    <section className="overflow-x-auto rounded-2xl border border-white/10 p-4 text-sm">
      <table className="w-full">
        <thead className="text-left text-[11px] uppercase tracking-wide opacity-50"><tr><th>who</th><th>rated</th><th>would film</th><th>nothing wrong</th><th>cheesy</th><th>generic</th><th>like AI</th><th>judge agrees</th></tr></thead>
        <tbody>{row("Maya", r.maya)}{row("Plain chatbot", r.baseline)}</tbody>
      </table>
    </section>
  );
}
