"use client";

/**
 * Standing instructions — the founder's steering directives, with history.
 * The engine reads only ACTIVE rows; superseded ones stay visible (struck
 * through) so the founder can see how their guidance evolved.
 */

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Card, Pill, ActionButton, timeAgo } from "../_components";

export function StandingInstructions() {
  const directives = useQuery(api.gtmMaya.steering.listMySteeringDirectives, {});
  const send = useMutation(api.gtmMaya.missionActions.sendMySteeringDirective);
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "sent" | "error">("idle");

  const submit = async () => {
    const directive = text.trim();
    if (!directive || state === "busy") return;
    setState("busy");
    try {
      await send({ directive });
      setText("");
      setState("sent");
      setTimeout(() => setState("idle"), 2500);
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 3000);
    }
  };

  const rows = directives ?? [];

  return (
    <Card>
      <div className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          rows={2}
          placeholder='Tell Maya how to operate — "never mention competitors by name", "focus on LinkedIn this month"…'
          className="min-h-[3.25rem] w-full resize-none bg-transparent text-sm leading-relaxed text-paper outline-none placeholder:text-paper-faint"
        />
        <ActionButton onClick={() => void submit()} busy={state === "busy"} disabled={!text.trim()}>
          Add
        </ActionButton>
      </div>
      {state === "sent" ? (
        <p className="mt-2 text-xs text-paper-dim">Saved — it shapes everything from here.</p>
      ) : state === "error" ? (
        <p className="mt-2 text-xs text-[#b3261e]">Didn&apos;t save — try again.</p>
      ) : null}

      {rows.length > 0 ? (
        <ol className="mt-4 space-y-2 border-t border-paper-faint/15 pt-4">
          {rows.map((d) => (
            <li key={d._id} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p
                  className={`text-sm leading-relaxed ${
                    d.active ? "text-paper" : "text-paper-faint line-through"
                  }`}
                >
                  {d.directive}
                </p>
                <div className="mt-1 flex items-center gap-2">
                  {d.active ? <Pill tone="lime">active</Pill> : <Pill tone="paper">superseded</Pill>}
                  {d.intent ? (
                    <span className="font-mono text-[10px] uppercase tracking-wide text-paper-faint">
                      {d.intent}
                    </span>
                  ) : null}
                </div>
              </div>
              <span className="shrink-0 font-mono text-[11px] text-paper-faint">
                {timeAgo(d.createdAt)}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-3 text-xs leading-relaxed text-paper-faint">
          Nothing yet. Anything you tell her here (or in Telegram) becomes a standing rule she
          applies to every post, reply, and plan.
        </p>
      )}
    </Card>
  );
}
