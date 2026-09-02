/**
 * Every tuned number in one place (plan §13). Each is a first guess to be revised
 * from pilot data; every row that depends on one records `THRESHOLDS.version`.
 */
export const THRESHOLDS = {
  version: "thresholds-2026-09-02.1",

  // §13.2 breakout ranking
  baselineMinPosts: 8, // fewer → baseline unknown, no breakouts for that account yet
  breakoutFloorRatio: 1.5, // noise floor into the candidate list; never a verdict
  breakoutMaxAgeHours: 96, // a post older than four days is not "moving"
  candidatesPerDay: 10, // what the scout skill sees

  // §13.8 gate rails
  dailyMessageCap: 3,
  quietHoursDefault: { start: "22:00", end: "07:00" },
  formatCooldownDays: 14,

  // §13.5 idea matching
  matchWindowDays: 14,

  // §13.7 rung
  formatRungBelow: 0.7,
  topicRungBelow: 0.7,
} as const;
