"use client";

/**
 * Service-product onboarding QuestionsStep — 11 Qs per § 5 step 7.
 *
 * Conversational chat-style cursor: one question at a time, click-to-advance
 * where possible (multi-select chips, single-select radios, free-text
 * textarea for the local-texture Q9/Q10/Q11).
 *
 * Q1 business name + service types
 * Q2 service area (city + miles OR zip codes)
 * Q3 business size
 * Q4 top 3 services
 * Q5 typical job ticket size bucket
 * Q6 tone preference
 * Q7 response speed
 * Q8 voice channel preference (skip / set up later / set up now)
 * Q9 top 3 local competitors (load-bearing for `localPositioning`)
 * Q10 neighborhoods/zips most jobs come from
 * Q11 recurring local hooks operator already uses
 *
 * Q9-Q11 are skippable — Maya backfills via cron behaviors over time.
 */

import { useState } from "react";
import {
  BUSINESS_SIZE_LABELS,
  RESPONSE_SPEED_LABELS,
  SERVICE_TYPE_LABELS,
  TICKET_SIZE_LABELS,
  TONE_LABELS,
  setAnswer,
  type BusinessSizeBucket,
  type OnboardingState,
  type ResponseSpeed,
  type ServiceTone,
  type ServiceTypeId,
  type TicketSizeBucket,
} from "../_state";

interface Props {
  state: OnboardingState;
  setState: (next: OnboardingState | ((p: OnboardingState) => OnboardingState)) => void;
  onAdvance: () => void;
}

export function QuestionsStep({ state, setState, onAdvance }: Props) {
  const [step, setStepIdx] = useState<number>(0);
  const a = state.answers;

  const update = <K extends keyof typeof a>(k: K, v: (typeof a)[K]) => {
    setState((p) => setAnswer(p, k, v));
  };

  const next = () => setStepIdx((s) => s + 1);

  if (step === 0) {
    return (
      <Q
        title="What's the business called?"
        subtitle="The name your customers see on Google."
      >
        <input
          autoFocus
          value={a.businessName}
          onChange={(e) => update("businessName", e.target.value)}
          placeholder="e.g. Henderson Plumbing"
          className="input input-paper w-full"
        />
        <div className="mt-3 font-display text-base text-paper-dim">
          And which service types?
        </div>
        <Chips
          options={Object.keys(SERVICE_TYPE_LABELS) as ServiceTypeId[]}
          selected={a.serviceTypes}
          labels={SERVICE_TYPE_LABELS}
          onToggle={(id) => {
            update(
              "serviceTypes",
              a.serviceTypes.includes(id)
                ? a.serviceTypes.filter((s) => s !== id)
                : [...a.serviceTypes, id]
            );
          }}
        />
        <Continue
          disabled={
            a.businessName.trim().length === 0 || a.serviceTypes.length === 0
          }
          onClick={next}
        />
      </Q>
    );
  }

  if (step === 1) {
    return (
      <Q title="Where do you work?" subtitle="City or zip codes — pick one.">
        <input
          value={a.serviceArea.city}
          onChange={(e) =>
            update("serviceArea", { ...a.serviceArea, city: e.target.value })
          }
          placeholder="e.g. Lincoln, NE"
          className="input input-paper w-full"
        />
        <div className="mt-2 text-sm text-paper-faint">…and a radius:</div>
        <input
          type="number"
          min={1}
          max={100}
          value={a.serviceArea.radiusMiles ?? ""}
          onChange={(e) =>
            update("serviceArea", {
              ...a.serviceArea,
              radiusMiles: e.target.value === "" ? null : Number(e.target.value),
            })
          }
          placeholder="25"
          className="input input-paper w-full"
        />
        <Continue
          disabled={a.serviceArea.city.trim().length === 0}
          onClick={next}
        />
      </Q>
    );
  }

  if (step === 2) {
    return (
      <Q title="How big is the team?" subtitle="">
        <Radio<BusinessSizeBucket>
          options={Object.keys(BUSINESS_SIZE_LABELS) as BusinessSizeBucket[]}
          selected={a.businessSize}
          labels={BUSINESS_SIZE_LABELS}
          onPick={(id) => {
            update("businessSize", id);
            setTimeout(next, 200);
          }}
        />
      </Q>
    );
  }

  if (step === 3) {
    return (
      <Q
        title="Top 3 services"
        subtitle="Comma-separated — Maya uses these in posts + review replies."
      >
        <textarea
          value={a.topServices.join(", ")}
          onChange={(e) =>
            update(
              "topServices",
              e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter((s) => s.length > 0)
                .slice(0, 5)
            )
          }
          placeholder="AC tune-up, furnace replacement, drain clearing"
          rows={2}
          className="input input-paper w-full"
        />
        <Continue disabled={a.topServices.length === 0} onClick={next} />
      </Q>
    );
  }

  if (step === 4) {
    return (
      <Q title="Typical job ticket size?" subtitle="">
        <Radio<TicketSizeBucket>
          options={Object.keys(TICKET_SIZE_LABELS) as TicketSizeBucket[]}
          selected={a.ticketSize}
          labels={TICKET_SIZE_LABELS}
          onPick={(id) => {
            update("ticketSize", id);
            setTimeout(next, 200);
          }}
        />
      </Q>
    );
  }

  if (step === 5) {
    return (
      <Q
        title="What tone should Maya have?"
        subtitle="You can adjust later from Profile."
      >
        <Radio<ServiceTone>
          options={Object.keys(TONE_LABELS) as ServiceTone[]}
          selected={a.tone}
          labels={TONE_LABELS}
          onPick={(id) => {
            update("tone", id);
            setTimeout(next, 200);
          }}
        />
      </Q>
    );
  }

  if (step === 6) {
    return (
      <Q
        title="How fast should Maya reply when you text her?"
        subtitle=""
      >
        <Radio<ResponseSpeed>
          options={Object.keys(RESPONSE_SPEED_LABELS) as ResponseSpeed[]}
          selected={a.responseSpeed}
          labels={RESPONSE_SPEED_LABELS}
          onPick={(id) => {
            update("responseSpeed", id);
            setTimeout(next, 200);
          }}
        />
      </Q>
    );
  }

  if (step === 7) {
    return (
      <Q
        title="Set up voice now?"
        subtitle="Studio operators can have Maya answer the phone. Skip if you want text-only."
      >
        <Radio<typeof a.voiceChoice>
          options={["skip", "set-up-later", "set-up-now"]}
          selected={a.voiceChoice}
          labels={{
            skip: "Skip — text only",
            "set-up-later": "Maybe later",
            "set-up-now": "Set up now (Studio)",
          }}
          onPick={(id) => {
            update("voiceChoice", id);
            setTimeout(next, 200);
          }}
        />
      </Q>
    );
  }

  if (step === 8) {
    return (
      <Q
        title="Top 3 local competitors? (skippable)"
        subtitle="Names of the plumber / HVAC / roofer down the street you consider direct competition. Maya looks them up + watches their GBP for you."
      >
        <textarea
          value={a.namedCompetitors.join(", ")}
          onChange={(e) =>
            update(
              "namedCompetitors",
              e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter((s) => s.length > 0)
                .slice(0, 5)
            )
          }
          placeholder="e.g. Acme Plumbing, Drain Doctors, Big City HVAC"
          rows={2}
          className="input input-paper w-full"
        />
        <SkipOrContinue onSkip={next} onContinue={next} />
      </Q>
    );
  }

  if (step === 9) {
    return (
      <Q
        title="Where do most jobs come from? (skippable)"
        subtitle="Neighborhoods or zips you do most of your work in. Powers local-hook insertion in posts."
      >
        <textarea
          value={a.neighborhoodEmphasis.join(", ")}
          onChange={(e) =>
            update(
              "neighborhoodEmphasis",
              e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter((s) => s.length > 0)
                .slice(0, 8)
            )
          }
          placeholder="e.g. Lincoln Park, Lakeview, West Loop"
          rows={2}
          className="input input-paper w-full"
        />
        <SkipOrContinue onSkip={next} onContinue={next} />
      </Q>
    );
  }

  if (step === 10) {
    return (
      <Q
        title="Local hooks you already use? (skippable)"
        subtitle="Examples: 'we sponsor the Lincoln Park Little League', 'I do a lot of work in the historic district', 'freezes hit us hard in February'. Maya weaves these into content."
      >
        <textarea
          value={a.localHooks.join("\n")}
          onChange={(e) =>
            update(
              "localHooks",
              e.target.value
                .split("\n")
                .map((s) => s.trim())
                .filter((s) => s.length > 0)
                .slice(0, 6)
            )
          }
          placeholder="One per line"
          rows={4}
          className="input input-paper w-full"
        />
        <SkipOrContinue
          onSkip={() => onAdvance()}
          onContinue={() => onAdvance()}
        />
      </Q>
    );
  }

  // Fallthrough — every Q answered
  return (
    <section>
      <p className="text-paper-dim">All set. Maya is forming her first picture.</p>
      <Continue disabled={false} onClick={onAdvance} />
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Building blocks                                                             */
/* -------------------------------------------------------------------------- */

function Q({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="font-display text-3xl tracking-tight text-paper">
        {title}
      </h2>
      {subtitle ? (
        <p className="mt-2 text-paper-dim">{subtitle}</p>
      ) : null}
      <div className="mt-6 space-y-3">{children}</div>
    </section>
  );
}

function Chips<T extends string>({
  options,
  selected,
  labels,
  onToggle,
}: {
  options: ReadonlyArray<T>;
  selected: ReadonlyArray<T>;
  labels: Record<T, string>;
  onToggle: (id: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((id) => {
        const on = selected.includes(id);
        return (
          <button
            key={id}
            onClick={() => onToggle(id)}
            className={`rounded-full border px-4 py-2 text-sm font-display transition-colors ${
              on
                ? "border-lime bg-lime text-ink"
                : "border-ink-2 text-paper-dim hover:border-paper-faint"
            }`}
          >
            {labels[id]}
          </button>
        );
      })}
    </div>
  );
}

function Radio<T extends string>({
  options,
  selected,
  labels,
  onPick,
}: {
  options: ReadonlyArray<T>;
  selected: T | null;
  labels: Record<T, string>;
  onPick: (id: T) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {options.map((id) => {
        const on = selected === id;
        return (
          <button
            key={id}
            onClick={() => onPick(id)}
            className={`rounded-2xl border p-4 text-left transition-colors ${
              on
                ? "border-lime bg-ink-2"
                : "border-ink-2 hover:border-paper-faint"
            }`}
          >
            <span className="font-display text-base text-paper">
              {labels[id]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Continue({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <div className="mt-6">
      <button
        onClick={onClick}
        disabled={disabled}
        className="btn btn-primary"
      >
        Continue
      </button>
    </div>
  );
}

function SkipOrContinue({
  onSkip,
  onContinue,
}: {
  onSkip: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="mt-6 flex flex-wrap gap-3">
      <button onClick={onContinue} className="btn btn-primary">
        Continue
      </button>
      <button onClick={onSkip} className="btn btn-ghost">
        Skip
      </button>
    </div>
  );
}
