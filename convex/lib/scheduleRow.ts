/**
 * S0 #1: the slim projection of a creator that every fleet job selects on. Pure, plus one
 * writer that makes the `schedule` row match its creator. The trigger in `lib/functions.ts`
 * calls `syncSchedule` on every creators write; the nightly reconcile calls it for drift.
 *
 * Adding a field a due-query needs: add it to the schema's `schedule` table and here. The
 * sibling test in core/__tests__/schedule.test.ts asserts every key here is in the schema.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { GenericDatabaseWriter } from "convex/server";
import type { DataModel } from "../_generated/dataModel";

export type ScheduleFields = Omit<Doc<"schedule">, "_id" | "_creationTime">;

/** Keywords kept per creator: sweep reads the first 8, sounds matches any. */
const MAX_KEYWORDS = 20;

export function scheduleFields(c: Doc<"creators">): ScheduleFields {
  const dossier = c.dossier as { keywords?: unknown } | undefined;
  const keywords = Array.isArray(dossier?.keywords)
    ? (dossier.keywords as unknown[]).filter((k): k is string => typeof k === "string").map((k) => k.trim().toLowerCase()).filter(Boolean).slice(0, MAX_KEYWORDS)
    : [];
  return {
    creatorId: c._id,
    paired: c.channel.paired,
    pairedAt: c.channel.pairedAt,
    status: c.plan.status,
    timezone: c.timezone,
    quietHours: { start: c.quietHours.start, end: c.quietHours.end },
    hasDossier: Boolean(c.dossier),
    keywords,
    preferredSendHour: c.preferredSendHour,
    createdAt: c.createdAt,
    firstWeekStartedAt: c.firstWeek?.startedAt,
    inviteDrafted: c.firstWeek?.stepsDone.includes("invite_draft") ?? false,
    handles: { tiktok: c.handles.tiktok, instagram: c.handles.instagram },
    tasteUpdatedAt: c.taste?.updatedAt,
    tasteEventsSeen: c.taste?.eventsSeen,
    isEval: /^eval(-run)?:/.test(c.clerkUserId),
  };
}

/** Deep, key-order-independent serialisation; undefined fields are absent, as in a stored document. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function same(row: Doc<"schedule">, next: ScheduleFields): boolean {
  const { _id, _creationTime, ...cur } = row;
  void _id; void _creationTime;
  return stable(cur) === stable(next);
}

/**
 * Make the schedule row match the creator: insert, update only when a selected field
 * changed (creators are patched constantly; most patches touch nothing here), or delete
 * when the creator is gone. Takes the raw writer so it never re-enters the trigger.
 */
export async function syncSchedule(db: GenericDatabaseWriter<DataModel>, creatorId: Id<"creators">): Promise<"inserted" | "updated" | "deleted" | "unchanged"> {
  const creator = await db.get(creatorId);
  const rows = await db.query("schedule").withIndex("by_creator", (q) => q.eq("creatorId", creatorId)).collect();
  if (!creator) {
    for (const r of rows) await db.delete(r._id);
    return rows.length ? "deleted" : "unchanged";
  }
  const next = scheduleFields(creator);
  const [row, ...dupes] = rows;
  for (const d of dupes) await db.delete(d._id);
  if (!row) {
    await db.insert("schedule", next);
    return "inserted";
  }
  if (same(row, next)) return dupes.length ? "updated" : "unchanged";
  await db.replace(row._id, next);
  return "updated";
}

/** Statuses that never get proactive fleet work. */
export const INACTIVE_STATUSES: ReadonlySet<string> = new Set(["paused", "canceled", "deleting"]);
