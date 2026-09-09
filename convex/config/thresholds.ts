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
  // §3 daily budgets per creator, trial and paid alike (tune from the ledger)
  dailyUsdCap: 0.75,
  dailyWatchCap: 8,
  dailyCreditCap: 60,
  // 2026-09-09: the vendor sat at ZERO credits while the smoke check said ok, because the HTTP call succeeded. A balance under this is a failure that pages.
  creditFloor: 200,
  quietHoursDefault: { start: "22:00", end: "07:00" },
  formatCooldownDays: 14,

  // §22 frames: sketches per creator per week (3 × $0.12 keeps frames under $1.60 a month at the cap), and renders in flight across the fleet
  // 2026-09-08: the image skill is off her belt; 0 sketches a week keeps the code and refuses the work.
  framesPerWeek: 0,
  framesMaxInFlight: 8,

  // §24 the human cadence: "saw this, thought of you" per creator per week
  forYouPerWeek: 2,

  // §13.5 idea matching
  matchWindowDays: 14,

  // §13.7 rung
  formatRungBelow: 0.7,
  topicRungBelow: 0.7,
} as const;
