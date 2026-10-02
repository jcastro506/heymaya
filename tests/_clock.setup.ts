/**
 * Every test file starts at the same daytime moment, whatever time CI runs (2026-10-01). Quiet hours
 * are now held inside `messages.send`, and tests that never set a time used to pass only because the
 * suite happened to run in the day: run at 3am, 21 of them failed. Time still moves (elapsed real time
 * is added), fake timers still override it, and tests about quiet hours set their own times.
 */
import { vi } from "vitest";

export const TEST_CLOCK_START = Date.UTC(2026, 9, 1, 15, 0); // a Thursday afternoon, UTC
const offset = TEST_CLOCK_START - Date.now();
const real = Date.now.bind(Date);
vi.spyOn(Date, "now").mockImplementation(() => real() + offset);

// No real typing pauses between her bubbles in tests (core/imessage partGapMs).
process.env.PART_GAP_SCALE = "0";
