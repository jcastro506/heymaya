import { describe, expect, it } from "vitest";
import {
  buildCalendarHold,
  calendarHoldIdempotencyKey,
  canMutateCalendarEvent,
  mayaCalendarOwnerKey,
} from "../calendarScheduling";

const hour = 60 * 60 * 1000;
const base = Date.UTC(2026, 4, 4, 13, 0, 0);

describe("Creator Maya v0 calendar scheduling", () => {
  it("requires explicit creator approval before creating a hold", () => {
    const result = buildCalendarHold({
      creatorId: "creator_1",
      planItemId: "idea_1",
      title: "Film TikTok",
      description: "Result-first post",
      durationMin: 45,
      searchStartMs: base,
      searchEndMs: base + 4 * hour,
      busyBlocks: [],
      approvedByCreator: false,
    });

    expect(result).toEqual({ ok: false, reason: "approval_required" });
  });

  it("finds the first conflict-free slot and creates a stable idempotency key", () => {
    const request = {
      creatorId: "creator_1",
      planItemId: "idea_1",
      title: "Film TikTok",
      description: "Result-first post",
      durationMin: 45,
      searchStartMs: base,
      searchEndMs: base + 4 * hour,
      busyBlocks: [{ startMs: base, endMs: base + hour }],
      approvedByCreator: true,
    };

    const first = buildCalendarHold(request);
    const second = buildCalendarHold(request);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(first.hold.startMs).toBe(base + hour);
    expect(first.hold.idempotencyKey).toBe(second.hold.idempotencyKey);
    expect(first.hold.idempotencyKey).toBe(
      calendarHoldIdempotencyKey({
        creatorId: "creator_1",
        planItemId: "idea_1",
        startMs: base + hour,
        endMs: base + hour + 45 * 60 * 1000,
      })
    );
  });

  it("returns no_available_slot instead of forcing a calendar conflict", () => {
    const result = buildCalendarHold({
      creatorId: "creator_1",
      planItemId: "idea_1",
      title: "Film TikTok",
      description: "Result-first post",
      durationMin: 60,
      searchStartMs: base,
      searchEndMs: base + hour,
      busyBlocks: [{ startMs: base, endMs: base + hour }],
      approvedByCreator: true,
    });

    expect(result).toEqual({ ok: false, reason: "no_available_slot" });
  });

  it("allows updates and deletes only for Maya-owned events in the same creator account", () => {
    expect(
      canMutateCalendarEvent(
        {
          providerEventId: "evt_1",
          creatorId: "creator_1",
          startMs: base,
          endMs: base + hour,
          createdBy: "maya",
          mayaOwnerKey: mayaCalendarOwnerKey("creator_1", "idea_1"),
        },
        "creator_1"
      )
    ).toBe(true);

    expect(
      canMutateCalendarEvent(
        {
          providerEventId: "evt_2",
          creatorId: "creator_1",
          startMs: base,
          endMs: base + hour,
          createdBy: "creator",
        },
        "creator_1"
      )
    ).toBe(false);

    expect(
      canMutateCalendarEvent(
        {
          providerEventId: "evt_3",
          creatorId: "creator_2",
          startMs: base,
          endMs: base + hour,
          createdBy: "maya",
          mayaOwnerKey: mayaCalendarOwnerKey("creator_2", "idea_1"),
        },
        "creator_1"
      )
    ).toBe(false);
  });
});
