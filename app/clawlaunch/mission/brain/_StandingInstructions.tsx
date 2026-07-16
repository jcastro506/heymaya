"use client";

/**
 * Standing instructions — the founder's active rules as switch-rows, plus an
 * add input. Maya reads only ACTIVE rows (the query returns only those); a
 * new directive relays to her and she acknowledges in the founder's chat.
 */

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Btn, monoDate } from "../_components";

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
      setTimeout(() => setState("idle"), 3500);
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 3000);
    }
  };

  const rows = directives ?? [];

  return (
    <>
      {rows.map((d) => (
        <div key={d._id} className="mc-rule">
          <span className="mc-sw" role="img" aria-label="active" />
          <div className="min-w-0">
            <div className="txt">{d.directive}</div>
            <div className="meta">
              {d.intent ? `${d.intent} · ` : ""}
              {monoDate(d.createdAt)}
            </div>
          </div>
        </div>
      ))}
      <div className="mc-addrule">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="Add an instruction — e.g. “skip weekends”"
          aria-label="Add an instruction"
        />
        <Btn
          tone="primary"
          busy={state === "busy"}
          disabled={!text.trim()}
          onClick={() => void submit()}
        >
          Add
        </Btn>
      </div>
      <div className="mc-hint">
        {state === "sent"
          ? "Sent — Maya will confirm in your chat."
          : state === "error"
            ? "Didn't save — try again."
            : "Maya confirms every new instruction in your chat."}
      </div>
    </>
  );
}
