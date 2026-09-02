import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * Fleet clocks (plan §6 Sprint 2, §16.2). Per-creator cadence is computed in the
 * creator's timezone inside the jobs these fire; nothing here knows a timezone.
 */
const crons = cronJobs();

// The queue backstop. Anything a creator is waiting on is drained inline by `deliverNow`.
crons.interval("drain jobs", { minutes: 1 }, internal.core.scheduler.drainJobs, {});

// The tracked-account sampler: one read per distinct admired account per 6 h, fleet-wide (§13.2).
crons.interval("sample tracked accounts", { hours: 6 }, internal.scout.sampler.run, {});

// The niche sweep: one search per distinct lane keyword per day, shared across creators (§3.2).
crons.daily("sweep lane keywords", { hourUTC: 11, minuteUTC: 30 }, internal.scout.sweep.run, {});

// The daily readback: their own posts and numbers, and a `win` signal when one crosses 3× (§21.5).
crons.daily("readback own posts", { hourUTC: 1, minuteUTC: 15 }, internal.scout.readback.run, {});

// The scout: rails then judgment, per creator, in their daytime; the gate holds the cap and quiet hours (§13.8).
crons.hourly("scout", { minuteUTC: 5 }, internal.scout.scout.runAll, {});

// The calendar sync: every connected calendar, every 30 minutes; push channels are post-pilot (§12.5).
crons.interval("sync calendars", { minutes: 30 }, internal.calendar.sync.runAll, {});

// Taste (§13.10): silence on an idea becomes an event after 72 h; the taste note is rewritten weekly.
crons.daily("expire ignored ideas", { hourUTC: 2, minuteUTC: 0 }, internal.taste.events.expireIgnored, {});
crons.daily("taste profiles", { hourUTC: 9, minuteUTC: 0 }, internal.taste.profile.runAll, {});

// The weekly review: Sunday morning on each creator's clock; the hourly check finds who is due (§11.2 #14).
crons.hourly("weekly review", { minuteUTC: 35 }, internal.review.weekly.runAll, {});

// Nightly consolidation (§15.7 layer 3, code half): expired notes tombstoned, the reply hour learned.
crons.daily("consolidate", { hourUTC: 3, minuteUTC: 0 }, internal.agent.consolidate.nightly, {});

// The first week's day-4 invitation (§1): hers to initiate, enforced as a schedule row.
crons.hourly("first week", { minuteUTC: 50 }, internal.scout.firstWeek.runAll, {});

// Sprint 3c: last night's real outbound through the checks and the judge, every night.
crons.daily("eval recent outbound", { hourUTC: 4, minuteUTC: 0 }, internal.eval.run.recent, {});

// The format watch (§13.12): the platform's trending feeds once a day, fleet-wide; formats travel, topics don't.
crons.daily("format watch", { hourUTC: 12, minuteUTC: 0 }, internal.scout.formats.run, {});

// Sound signals (§13.8): a sound two or more lane accounts used this week, once a day, after the sweep.
crons.daily("sound signals", { hourUTC: 12, minuteUTC: 30 }, internal.scout.sounds.run, {});

// Nothing fails silently (§16): one operator message an hour when something new went wrong.
crons.hourly("operator alerts", { minuteUTC: 20 }, internal.core.alerts.run, {});

// Retention (§16.5): messages 12 months, calendar fields 90 days rolling, expired oauth states; nightly, bounded.
crons.daily("retention", { hourUTC: 3, minuteUTC: 30 }, internal.core.retention.nightly, {});

// Creator-facing status (§7 S3): "behind today" / "couldn't see TikTok today", once a day each, only when true.
crons.hourly("creator status", { minuteUTC: 25 }, internal.core.status.run, {});

export default crons;
