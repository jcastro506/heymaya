"use client";

/**
 * PlanDecideCard — the one-tap plan approval card for Today's "Needs you"
 * band. Compact by design: her read, the moves as channel chips, one
 * approve action. Discussion happens in the chat; the card only decides.
 * Renders null once approved (or before a plan exists).
 */

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Btn, Chip, channelLabel } from "./_components";

export function PlanDecideCard() {
  const data = useQuery(api.gtmMaya.planDoc.getMyPlanDoc);
  const approve = useMutation(api.gtmMaya.planDoc.approveMyPlan);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!data?.plan || data.plan.status === "approved") return null;
  const { plan } = data;

  const doApprove = async () => {
    setBusy(true);
    setError(null);
    try {
      await approve({});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const moves = plan.moves ?? [];
  const channels = [
    ...new Set(moves.map((m) => m.channel).filter((c): c is string => Boolean(c))),
  ];
  const goal =
    plan.goal?.metric != null
      ? `${plan.goal.target ? `${plan.goal.target} ` : ""}${plan.goal.metric}`
      : null;

  return (
    <div className="mc-action">
      <div className="mc-action-src">
        <Chip className="mc-chip-fresh">her plan · your call</Chip>
        <span className="mc-when mc-num">v{plan.version}</span>
      </div>
      {plan.read ? <div className="mc-thread">“{plan.read}”</div> : null}
      <div className="mc-draft">
        {moves.length > 0 ? `${moves.length} moves` : null}
        {goal ? `${moves.length > 0 ? " → " : ""}${goal}` : null}
      </div>
      {channels.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {channels.map((c) => (
            <Chip key={c} platform={c}>
              {channelLabel(c)}
            </Chip>
          ))}
        </div>
      ) : null}
      <div className="mc-acts items-center">
        <Btn tone="primary" busy={busy} onClick={() => void doApprove()}>
          Approve the plan
        </Btn>
        <span className="mc-hint !mt-0">Changes? Tell her in chat.</span>
      </div>
      {error ? <p className="text-xs text-rose">{error}</p> : null}
    </div>
  );
}
