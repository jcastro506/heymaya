"use client";

/**
 * The plan, as the founder reads / argues with / approves it.
 *
 *  - <PlanDecideCard /> — the one-tap approval card for Today's "Needs you"
 *    tray. Renders only while the plan is waiting on the founder.
 *  - <PlanArchive />    — the approved plan doc, collapsed, for Brain.
 *
 * Discussion happens in Telegram; every exchange lands here as a new version
 * (live Convex subscription on getMyPlanDoc).
 */

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { PlanDoc } from "@/convex/gtmMaya/planDoc";
import { ActionButton, Card, Fold, Pill, timeAgo } from "./_components";

type Plan = PlanDoc;

/** The plan body — read, goal, moves, not-doing, week shape, amendments. */
function PlanBody({ plan }: { plan: Plan }) {
  return (
    <>
      {plan.read ? (
        <p className="mt-3 font-display text-lg italic leading-snug text-paper">
          “{plan.read}”
        </p>
      ) : null}

      {plan.goal?.metric ? (
        <p className="mt-3 text-sm text-paper">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
            Goal{" "}
          </span>
          {plan.goal.target ? `${plan.goal.target} ` : ""}
          {plan.goal.metric}
          {plan.goal.byMs
            ? ` by ${new Date(plan.goal.byMs).toLocaleDateString([], { month: "short", day: "numeric" })}`
            : ""}
        </p>
      ) : null}

      {(plan.moves ?? []).length > 0 ? (
        <div className="mt-4">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
            The moves
          </p>
          <ol className="space-y-2">
            {(plan.moves ?? []).map((m, i) => (
              <li key={i} className="rounded-xl border border-paper-faint/15 bg-ink p-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-paper">{m.name}</span>
                  {m.channel ? (
                    <Pill tone="paper">{m.channel === "x" ? "X" : m.channel}</Pill>
                  ) : null}
                </div>
                {m.intent ? (
                  <p className="mt-1 text-xs leading-relaxed text-paper-dim">{m.intent}</p>
                ) : null}
                {m.expect ? (
                  <p className="mt-1 text-[11px] text-paper-faint">Expecting: {m.expect}</p>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {(plan.notDoing ?? []).length > 0 ? (
        <div className="mt-4">
          <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
            Deliberately not doing
          </p>
          <ul className="space-y-1">
            {(plan.notDoing ?? []).map((n, i) => (
              <li key={i} className="text-xs leading-relaxed text-paper-dim">
                <span className="text-paper">{n.channel ?? "—"}</span> · {n.why}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {plan.week ? (
        <p className="mt-4 text-xs leading-relaxed text-paper-dim">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
            A normal week{" "}
          </span>
          {Object.entries(plan.week)
            .map(([k, v]) => `${k.replace(/([A-Z])/g, " $1").toLowerCase()}: ${String(v)}`)
            .join(" · ")}
        </p>
      ) : null}

      {(plan.amendments ?? []).length > 0 ? (
        <details className="mc-fold mt-4 border-t border-paper-faint/10 pt-3">
          <summary className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
            <span className="mc-caret">▸</span> Changes you asked for ·{" "}
            {(plan.amendments ?? []).length}
          </summary>
          <ol className="mt-2 space-y-1.5">
            {(plan.amendments ?? []).map((a, i) => (
              <li key={i} className="text-xs leading-relaxed text-paper-dim">
                <span className="font-mono text-[10px] text-paper-faint">v{a.v}</span> “
                {a.directive}” → {a.diff}
                <span className="ml-1 font-mono text-[10px] text-paper-faint">
                  {timeAgo(a.atMs)}
                </span>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </>
  );
}

/** One-tap plan approval for Today. Null once approved (or before a plan). */
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

  return (
    <Card className="border-l-2 border-l-lime">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="lime">her plan — your call</Pill>
        <span className="font-mono text-[11px] text-paper-faint">v{plan.version}</span>
      </div>
      <PlanBody plan={plan} />
      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-paper-faint/10 pt-4">
        <ActionButton onClick={() => void doApprove()} busy={busy}>
          Approve the plan
        </ActionButton>
        <span className="text-[11px] text-paper-faint">
          Want changes? Tell her in Telegram — the plan updates here.
        </span>
      </div>
      {error ? <p className="mt-2 text-xs text-rose">{error}</p> : null}
    </Card>
  );
}

/** The plan doc, collapsed — Brain's archive shelf. */
export function PlanArchive() {
  const data = useQuery(api.gtmMaya.planDoc.getMyPlanDoc);
  if (!data?.plan) return null;
  const { plan } = data;
  const approved = plan.status === "approved";

  return (
    <Fold label={approved ? "The approved plan" : "The plan (awaiting your approval)"}>
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={approved ? "lime" : "paper"}>
            {approved ? "approved" : "waiting on you"}
          </Pill>
          <span className="font-mono text-[11px] text-paper-faint">v{plan.version}</span>
        </div>
        <PlanBody plan={plan} />
        {!approved ? (
          <p className="mt-4 border-t border-paper-faint/10 pt-3 text-[11px] text-paper-faint">
            Approve it from Today — nothing runs until you do.
          </p>
        ) : null}
      </Card>
    </Fold>
  );
}
