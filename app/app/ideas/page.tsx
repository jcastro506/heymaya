"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const CHIP: Record<string, string> = { sent: "border-white/20", hearted: "border-pink-400 text-pink-300", posted: "border-emerald-400 text-emerald-300", passed: "border-white/10 opacity-50", expired: "border-white/10 opacity-40" };

export default function IdeasPage() {
  const [unposted, setUnposted] = useState(false);
  const [savedOnly, setSavedOnly] = useState(false);
  const ideas = useQuery(api.ui.ideas, { unpostedOnly: unposted, savedOnly });
  const pass = useMutation(api.ui.passIdea);
  const posted = useMutation(api.taste.events.markPosted);
  const [open, setOpen] = useState<string | null>(null);
  if (ideas === undefined) return <p className="opacity-60 text-sm">loading…</p>;
  if (ideas === null) return <p className="text-sm">No account yet.</p>;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">Ideas</h1>
        <span className="flex gap-3">
          <label className="text-xs opacity-70 flex items-center gap-2"><input type="checkbox" checked={unposted} onChange={(e) => setUnposted(e.target.checked)} /> unposted</label>
          <label className="text-xs opacity-70 flex items-center gap-2"><input type="checkbox" checked={savedOnly} onChange={(e) => setSavedOnly(e.target.checked)} /> saved</label>
        </span>
      </div>
      {ideas.length === 0 && <p className="text-sm opacity-60">Nothing yet. Ideas land here with their evidence the moment she texts one.</p>}
      <ul className="flex flex-col gap-3">
        {ideas.map((i) => (
          <li key={i.id} className="border border-white/10 rounded-lg p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <span className={`text-[11px] uppercase tracking-wide px-2 py-0.5 rounded-full border ${CHIP[i.status] ?? ""}`}>{i.status}</span>
                {i.reaction && i.reaction !== "removed" && <span className="text-xs">{i.reaction}</span>}
                {i.newForYou && <span className="text-[11px] opacity-60">not your usual</span>}
                {i.saved && <span className="text-[11px] opacity-60">saved</span>}
              </span>
              <span className="text-[11px] opacity-50">{i.sentAt ? new Date(i.sentAt).toLocaleDateString() : ""}</span>
            </div>
            <p className="mt-2 whitespace-pre-wrap">{open === i.id ? i.messageText : i.messageText.slice(0, 160) + (i.messageText.length > 160 ? "…" : "")}</p>
            {i.evidenceLinks.map((l) => <a key={l} className="underline text-xs break-all block mt-1" href={l} target="_blank" rel="noreferrer">{l}</a>)}
            {open === i.id && i.version && (
              <div className="mt-2 text-xs opacity-80 flex flex-col gap-1">
                {i.version.hook && <div><b>hook</b> · {i.version.hook}</div>}
                {i.version.onScreenText && <div><b>on screen</b> · {i.version.onScreenText}</div>}
                {i.version.lengthSec ? <div><b>length</b> · {i.version.lengthSec}s</div> : null}
                {i.version.sound && <div><b>sound</b> · {i.version.sound}</div>}
                <div className="opacity-60">why it fits · {i.fitWhy}</div>
                {i.features && <div className="opacity-50">{[i.features.format, i.features.tone, i.features.lengthBucket, ...i.features.topics].filter((x) => x && x !== "unknown").join(" · ")}</div>}
              </div>
            )}
            <div className="mt-2 flex gap-3 text-xs">
              <button className="underline" onClick={() => setOpen(open === i.id ? null : i.id)}>{open === i.id ? "less" : "the version"}</button>
              {i.status !== "posted" && <button className="underline opacity-70" onClick={() => posted({ ideaId: i.id })}>posted it</button>}
              {i.status === "sent" && <button className="underline opacity-70" onClick={() => pass({ id: i.id })}>not for me</button>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
