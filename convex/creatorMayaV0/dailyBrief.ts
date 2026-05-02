export interface BriefCitation {
  sourceType: "creator_post" | "video_analysis" | "trend" | "memory" | "calendar";
  sourceId: string;
  summary: string;
}

export interface AvailabilityWindow {
  startMs: number;
  endMs: number;
}

export interface PlanIdea {
  id: string;
  hook: string;
  shotList: string;
  caption: string;
  whyItFits: string;
  durationMin: number;
  citations: ReadonlyArray<BriefCitation>;
}

export interface MorningBriefContext {
  creatorId: string;
  creatorName?: string;
  timezone: string;
  nowMs: number;
  lastOutboundUnanswered: boolean;
  todaysAvailability: ReadonlyArray<AvailabilityWindow>;
  activePlanIdeas: ReadonlyArray<PlanIdea>;
  recentSignals: ReadonlyArray<{
    id: string;
    summary: string;
    citations: ReadonlyArray<BriefCitation>;
    urgency: "low" | "normal" | "high";
  }>;
}

export type MorningBriefResult =
  | {
      shouldSend: true;
      dailyBrief: {
        creatorId: string;
        planIdeaId: string;
        scheduledForLocalHour: 7;
        message: string;
        proposedWorkStartMs: number;
        proposedWorkEndMs: number;
        citations: ReadonlyArray<BriefCitation>;
      };
      actionLog: {
        action: "send_imessage";
        reason: "grounded_morning_move";
        citationCount: number;
      };
    }
  | {
      shouldSend: false;
      dailyBrief: {
        creatorId: string;
        scheduledForLocalHour: 7;
        noSendReason:
          | "no_grounded_action"
          | "no_calendar_availability"
          | "waiting_on_creator_reply";
        citations: ReadonlyArray<BriefCitation>;
      };
      actionLog: {
        action: "skip_imessage";
        reason: MorningBriefResultNoSendReason;
        citationCount: number;
      };
    };

type MorningBriefResultNoSendReason =
  | "no_grounded_action"
  | "no_calendar_availability"
  | "waiting_on_creator_reply";

export function buildMorningBrief(
  context: MorningBriefContext
): MorningBriefResult {
  const urgentSignal = context.recentSignals.find((s) => s.urgency === "high");
  if (context.lastOutboundUnanswered && !urgentSignal) {
    return skip(context, "waiting_on_creator_reply", []);
  }

  const idea = selectGroundedIdea(context.activePlanIdeas);
  if (!idea) return skip(context, "no_grounded_action", []);

  const slot = findWorkSlot(context.todaysAvailability, idea.durationMin);
  if (!slot) return skip(context, "no_calendar_availability", idea.citations);

  const signal = urgentSignal ?? context.recentSignals[0];
  const citations = dedupeCitations([
    ...(signal?.citations ?? []),
    ...idea.citations,
    {
      sourceType: "calendar",
      sourceId: `${slot.startMs}-${slot.endMs}`,
      summary: "Creator has availability for this content work block.",
    },
  ]);

  return {
    shouldSend: true,
    dailyBrief: {
      creatorId: context.creatorId,
      planIdeaId: idea.id,
      scheduledForLocalHour: 7,
      message: renderMorningMessage({
        signal: signal?.summary ?? idea.whyItFits,
        hook: idea.hook,
        fit: idea.whyItFits,
        startMs: slot.startMs,
        timezone: context.timezone,
      }),
      proposedWorkStartMs: slot.startMs,
      proposedWorkEndMs: slot.endMs,
      citations,
    },
    actionLog: {
      action: "send_imessage",
      reason: "grounded_morning_move",
      citationCount: citations.length,
    },
  };
}

export function nextMorningBriefLocalHour(): 7 {
  return 7;
}

function selectGroundedIdea(
  ideas: ReadonlyArray<PlanIdea>
): PlanIdea | null {
  return ideas.find((idea) => idea.citations.length > 0) ?? null;
}

function findWorkSlot(
  windows: ReadonlyArray<AvailabilityWindow>,
  durationMin: number
): AvailabilityWindow | null {
  const durationMs = durationMin * 60 * 1000;
  const sorted = [...windows].sort((a, b) => a.startMs - b.startMs);
  const found = sorted.find((window) => window.endMs - window.startMs >= durationMs);
  if (!found) return null;
  return {
    startMs: found.startMs,
    endMs: found.startMs + durationMs,
  };
}

function renderMorningMessage(args: {
  signal: string;
  hook: string;
  fit: string;
  startMs: number;
  timezone: string;
}): string {
  const time = renderLocalClock(args.startMs, args.timezone);
  return [
    `Morning. ${args.signal}`,
    `Today at ${time}, film: ${args.hook}.`,
    `${args.fit}`,
    `Reply "draft" for the shot list or "schedule" and I will hold the block.`,
  ].join(" ");
}

function renderLocalClock(ms: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: timezone,
  })
    .format(new Date(ms))
    .replace(":00", "")
    .replace(" AM", "am")
    .replace(" PM", "pm");
}

function skip(
  context: MorningBriefContext,
  reason: MorningBriefResultNoSendReason,
  citations: ReadonlyArray<BriefCitation>
): MorningBriefResult {
  return {
    shouldSend: false,
    dailyBrief: {
      creatorId: context.creatorId,
      scheduledForLocalHour: 7,
      noSendReason: reason,
      citations,
    },
    actionLog: {
      action: "skip_imessage",
      reason,
      citationCount: citations.length,
    },
  };
}

function dedupeCitations(
  citations: ReadonlyArray<BriefCitation>
): ReadonlyArray<BriefCitation> {
  const seen = new Set<string>();
  const out: BriefCitation[] = [];
  for (const citation of citations) {
    const key = `${citation.sourceType}:${citation.sourceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(citation);
  }
  return out;
}
