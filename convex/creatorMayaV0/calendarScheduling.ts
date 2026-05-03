export interface CalendarBusyBlock {
  startMs: number;
  endMs: number;
}

export interface CalendarHoldRequest {
  creatorId: string;
  planItemId: string;
  title: string;
  description: string;
  durationMin: number;
  searchStartMs: number;
  searchEndMs: number;
  busyBlocks: ReadonlyArray<CalendarBusyBlock>;
  approvedByCreator: boolean;
}

export interface MayaCalendarEvent {
  providerEventId: string;
  creatorId: string;
  startMs: number;
  endMs: number;
  createdBy: "maya" | "creator" | "external";
  mayaOwnerKey?: string;
}

export type CalendarHoldResult =
  | {
      ok: true;
      hold: {
        creatorId: string;
        planItemId: string;
        title: string;
        description: string;
        startMs: number;
        endMs: number;
        idempotencyKey: string;
        mayaOwnerKey: string;
      };
    }
  | {
      ok: false;
      reason:
        | "approval_required"
        | "invalid_window"
        | "invalid_duration"
        | "no_available_slot";
    };

const FIFTEEN_MIN_MS = 15 * 60 * 1000;

export function buildCalendarHold(
  request: CalendarHoldRequest
): CalendarHoldResult {
  if (!request.approvedByCreator) return { ok: false, reason: "approval_required" };
  if (request.durationMin <= 0) return { ok: false, reason: "invalid_duration" };
  if (request.searchEndMs <= request.searchStartMs) {
    return { ok: false, reason: "invalid_window" };
  }

  const durationMs = request.durationMin * 60 * 1000;
  const startMs = findFirstAvailableSlot({
    searchStartMs: request.searchStartMs,
    searchEndMs: request.searchEndMs,
    durationMs,
    busyBlocks: request.busyBlocks,
  });

  if (startMs === null) return { ok: false, reason: "no_available_slot" };

  const endMs = startMs + durationMs;
  const mayaOwnerKey = mayaCalendarOwnerKey(request.creatorId, request.planItemId);

  return {
    ok: true,
    hold: {
      creatorId: request.creatorId,
      planItemId: request.planItemId,
      title: request.title,
      description: request.description,
      startMs,
      endMs,
      idempotencyKey: calendarHoldIdempotencyKey({
        creatorId: request.creatorId,
        planItemId: request.planItemId,
        startMs,
        endMs,
      }),
      mayaOwnerKey,
    },
  };
}

export function canMutateCalendarEvent(
  event: MayaCalendarEvent,
  actorCreatorId: string
): boolean {
  return (
    event.creatorId === actorCreatorId &&
    event.createdBy === "maya" &&
    typeof event.mayaOwnerKey === "string" &&
    event.mayaOwnerKey.startsWith(`maya:${actorCreatorId}:`)
  );
}

export function mayaCalendarOwnerKey(
  creatorId: string,
  stableEventOrPlanId: string
): string {
  return `maya:${creatorId}:${stableEventOrPlanId}`;
}

export function calendarHoldIdempotencyKey(args: {
  creatorId: string;
  planItemId: string;
  startMs: number;
  endMs: number;
}): string {
  return [
    "calendar-hold",
    args.creatorId,
    args.planItemId,
    String(args.startMs),
    String(args.endMs),
  ].join(":");
}

function findFirstAvailableSlot(args: {
  searchStartMs: number;
  searchEndMs: number;
  durationMs: number;
  busyBlocks: ReadonlyArray<CalendarBusyBlock>;
}): number | null {
  let cursor = roundUp(args.searchStartMs, FIFTEEN_MIN_MS);
  const busy = [...args.busyBlocks]
    .filter((block) => block.endMs > block.startMs)
    .sort((a, b) => a.startMs - b.startMs);

  for (const block of busy) {
    if (block.endMs <= cursor) continue;
    if (cursor + args.durationMs <= block.startMs) return cursor;
    cursor = roundUp(Math.max(cursor, block.endMs), FIFTEEN_MIN_MS);
    if (cursor + args.durationMs > args.searchEndMs) return null;
  }

  return cursor + args.durationMs <= args.searchEndMs ? cursor : null;
}

function roundUp(value: number, increment: number): number {
  return Math.ceil(value / increment) * increment;
}
