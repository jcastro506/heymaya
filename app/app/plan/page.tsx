"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import Link from "next/link";

function dayKey(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function timeOf(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export default function PlanPage() {
  const p = useQuery(api.ui.plan);
  const control = useMutation(api.ui.blockControl);
  const [moving, setMoving] = useState<string | null>(null);
  const [when, setWhen] = useState("");
  if (p === undefined) return <p className="opacity-60 text-sm">loading…</p>;
  if (p === null) return <p className="text-sm">No account yet.</p>;
  const data = p;

  type Item = { at: number; kind: "block" | "event"; block?: (typeof data.blocks)[number]; event?: (typeof data.events)[number] };
  const items: Item[] = [...data.blocks.map((b) => ({ at: b.start, kind: "block" as const, block: b })), ...data.events.map((e) => ({ at: e.start, kind: "event" as const, event: e }))].sort((x, y) => x.at - y.at);
  const days = new Map<string, Item[]>();
  for (const it of items) days.set(dayKey(it.at), [...(days.get(dayKey(it.at)) ?? []), it]);

  async function move(id: (typeof data.blocks)[number]["id"], end: number, start: number) {
    const s = Date.parse(when);
    if (!Number.isFinite(s)) return;
    await control({ id, op: "move", start: s, end: s + (end - start) });
    setMoving(null);
    setWhen("");
  }

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h1 className="text-lg font-semibold">Plan</h1>
        <p className="text-sm opacity-70 mt-1">The next two weeks: her filming blocks and the events she means to use. Move or delete a block here and the calendar follows.</p>
        {!p.connected && <p className="text-sm mt-2">Calendar not connected. <Link className="underline" href="/app/settings">Connect it</Link> and she plans around your life.</p>}
        {p.bestHours.length > 0 && <p className="text-xs opacity-50 mt-1">Your best posting hours from your own numbers: {p.bestHours.map((h) => `${h}:00`).join(", ")}.</p>}
      </section>

      {items.length === 0 ? (
        <p className="text-sm opacity-60">Nothing planned yet. She proposes a block when something on your calendar is worth filming around.</p>
      ) : (
        Array.from(days.entries()).map(([day, list]) => (
          <section key={day}>
            <h2 className="text-sm uppercase tracking-wide opacity-50">{day}</h2>
            <ul className="mt-2 flex flex-col gap-2">
              {list.map((it) =>
                it.kind === "event" && it.event ? (
                  <li key={`e-${it.event.id}`} className="text-sm flex items-center justify-between opacity-80">
                    <span>{it.event.allDay ? "all day" : timeOf(it.event.start)} · {it.event.title}</span>
                    <span className="text-[11px] uppercase tracking-wide opacity-50">{it.event.class === "filmable" ? "worth filming" : it.event.class}</span>
                  </li>
                ) : it.block ? (
                  <li key={`b-${it.block.id}`} className="text-sm border border-white/10 rounded-lg px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span>{timeOf(it.block.start)}–{timeOf(it.block.end)} · {it.block.title}</span>
                      <span className={`text-[11px] uppercase tracking-wide ${it.block.status === "proposed" ? "text-amber-300" : "text-emerald-300"}`}>{it.block.status === "proposed" ? "waiting for your yes" : it.block.onCalendar ? "on your calendar" : it.block.status}</span>
                    </div>
                    <div className="mt-2 flex gap-3 text-xs">
                      {it.block.status === "proposed" && <button className="underline" onClick={() => control({ id: it.block!.id, op: "confirm" })}>yes, block it</button>}
                      <button className="underline opacity-70" onClick={() => setMoving(moving === it.block!.id ? null : it.block!.id)}>move</button>
                      <button className="underline opacity-70" onClick={() => control({ id: it.block!.id, op: "delete" })}>delete</button>
                    </div>
                    {moving === it.block.id && (
                      <div className="mt-2 flex gap-2">
                        <input className="input flex-1" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
                        <button className="btn" onClick={() => move(it.block!.id, it.block!.end, it.block!.start)}>move</button>
                      </div>
                    )}
                  </li>
                ) : null,
              )}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
