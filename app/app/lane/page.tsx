"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

function hoursAgo(ts: number): number {
  return Math.round((Date.now() - ts) / 3_600_000);
}

export default function LanePage() {
  const lane = useQuery(api.ui.lane);
  const validate = useAction(api.onboarding.admired.validate);
  const add = useMutation(api.onboarding.admired.add);
  const remove = useMutation(api.onboarding.admired.remove);
  const [handle, setHandle] = useState("");
  const [platform, setPlatform] = useState<"tiktok" | "instagram">("tiktok");
  const [error, setError] = useState<string | null>(null);
  if (lane === undefined) return <p className="opacity-60 text-sm">loading…</p>;
  if (lane === null) return <p className="text-sm">No account yet.</p>;

  async function addOne() {
    setError(null);
    const v = await validate({ platform, handle });
    if (!v.ok) return setError(v.reason ?? "couldn't check that account");
    const r = await add({ platform, handle });
    if (!r.ok) return setError(r.error ?? "couldn't add that account");
    setHandle("");
  }

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h1 className="text-lg font-semibold">Lane</h1>
        <p className="text-sm opacity-70 mt-1">Who she watches, and what moved. {lane.keywords.length > 0 && <span className="opacity-60">Your lane: {lane.keywords.join(", ")}.</span>}</p>
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-wide opacity-50">Accounts she watches</h2>
        <ul className="mt-2 flex flex-col gap-2">
          {lane.accounts.map((a) => (
            <li key={a.id} className="border border-white/10 rounded-lg px-3 py-2 text-sm">
              <div className="flex items-center justify-between">
                <span>@{a.handle} <span className="opacity-50">· {a.platform}</span></span>
                <button className="text-xs opacity-60 underline" onClick={() => remove({ id: a.id })}>stop watching</button>
              </div>
              <div className="text-xs opacity-60 mt-1">
                {a.lastSampledAt ? `looked ${hoursAgo(a.lastSampledAt)}h ago` : "watching from the next pass"}
                {a.baseline !== null ? ` · normal ≈ ${Math.round(a.baseline).toLocaleString()} views/h (${a.baselineN} posts)` : " · baseline not known yet"}
              </div>
              {a.lastBreakout && <div className="text-xs mt-1 opacity-80">last: {a.lastBreakout.score}× · {a.lastBreakout.verdict} · {a.lastBreakout.why.split(";")[0]}</div>}
            </li>
          ))}
        </ul>
        <div className="flex gap-2 mt-3">
          <select className="input w-28" value={platform} onChange={(e) => setPlatform(e.target.value as "tiktok" | "instagram")}>
            <option value="tiktok">TikTok</option>
            <option value="instagram">Instagram</option>
          </select>
          <input className="input flex-1" placeholder="@handle" value={handle} onChange={(e) => setHandle(e.target.value)} autoCapitalize="none" onKeyDown={(e) => e.key === "Enter" && addOne()} />
          <button className="btn" onClick={addOne}>add</button>
        </div>
        {error && <p className="text-sm text-red-400 mt-2">{error}</p>}
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-wide opacity-50">Rising in your lane</h2>
        {lane.rising.length === 0 ? (
          <p className="text-sm opacity-60 mt-2">Nothing surfaced yet. The lane sweep runs once a day.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {lane.rising.map((r) => (
              <li key={r.id} className="text-sm border-b border-white/5 py-2">
                <span className="text-[11px] uppercase tracking-wide opacity-50 mr-2">{r.verdict}</span>
                {r.why.split(";")[0]}
                {r.why.includes("http") && <a className="underline text-xs block break-all mt-1" href={r.why.split("; ").pop()} target="_blank" rel="noreferrer">{r.why.split("; ").pop()}</a>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
