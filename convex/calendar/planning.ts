/**
 * The week plan, as arithmetic (plan Sprint 4b).
 *
 * Everything in here is pure: given their cadence, their ideas, their calendar, their
 * post-time model and the clock, it returns the blocks she would propose. The action that
 * calls it writes rows and sends one message; the model writes nothing here. That is
 * deliberate: a plan is a set of facts about time, and a model asked to place five slots
 * across a week with real gaps will place two of them at 3am.
 */

import { atLocalHour, localHour, type PostTimeModel } from "./postTime";

export const PLAN = {
  minSlots: 1,
  maxSlots: 5,
  filmMinutes: 45,
  /** Editing block, by how much they cut. A single-shot creator gets the floor. */
  editMinutesFloor: 20,
  editMinutesCeiling: 90,
  /** Earliest and latest local hour a filming block may start. */
  dayStartHour: 8,
  dayEndHour: 21,
  /** Default filming hour when nothing in their history says otherwise. */
  defaultFilmHour: 17,
} as const;

export interface Busy { start: number; end: number }
export interface Fingerprint { medianCutSeconds?: number | null; cutsPerTenSeconds?: number | null }

/** How long editing takes them, from how they cut. Pure. */
export function editMinutesFor(fp: Fingerprint | null | undefined, noEditBlock?: boolean): number {
  if (noEditBlock) return 0;
  const cuts = fp?.cutsPerTenSeconds ?? (fp?.medianCutSeconds ? 10 / fp.medianCutSeconds : null);
  if (cuts === null || cuts === undefined || !Number.isFinite(cuts)) return PLAN.editMinutesFloor;
  // Under one cut per ten seconds is a single shot; four or more is a real edit.
  const t = Math.max(0, Math.min(1, (cuts - 1) / 3));
  return Math.round(PLAN.editMinutesFloor + t * (PLAN.editMinutesCeiling - PLAN.editMinutesFloor));
}

/**
 * A free window of at least `minutes` on the local day containing `dayEpoch`, preferring
 * `preferHour`, avoiding `busy`. Returns null when the day is full. Pure.
 */
export function freeSlotOn(dayEpoch: number, minutes: number, busy: Busy[], preferHour: number, timeZone: string): { start: number; end: number } | null {
  const span = minutes * 60_000;
  const dayBusy = busy.filter((b) => b.end > atLocalHour(dayEpoch, 0, timeZone) && b.start < atLocalHour(dayEpoch, 23, timeZone) + 3_600_000);
  const fits = (start: number) => dayBusy.every((b) => start + span <= b.start || start >= b.end);
  // Try the preferred hour, then walk outward from it, on the half hour.
  const order: number[] = [];
  for (let d = 0; d <= 13; d++) { order.push(preferHour + d); if (d) order.push(preferHour - d); }
  for (const h of order) {
    if (h < PLAN.dayStartHour || h > PLAN.dayEndHour) continue;
    for (const half of [0, 30]) {
      const start = atLocalHour(dayEpoch, h, timeZone) + half * 60_000;
      if (start + span > atLocalHour(dayEpoch, PLAN.dayEndHour, timeZone) + 3_600_000) continue;
      if (fits(start)) return { start, end: start + span };
    }
  }
  return null;
}

export interface IdeaLite { ideaId: string; hook: string; status: string; savedAt?: number | null; sentAt?: number | null; experiment?: boolean }

/** Which ideas fill the week: saved first, then hearted, then recent unexpired sends. The experiment goes last so it always gets a slot. Pure. */
export function pickIdeas(ideas: IdeaLite[], slots: number, experiment: string | null): Array<{ ideaId: string | null; hook: string; experiment: boolean }> {
  const rank = (i: IdeaLite) => (i.status === "saved" ? 0 : i.status === "hearted" ? 1 : i.status === "sent" ? 2 : 9);
  const pool = ideas.filter((i) => rank(i) < 9).sort((a, b) => rank(a) - rank(b) || (b.savedAt ?? b.sentAt ?? 0) - (a.savedAt ?? a.sentAt ?? 0));
  const n = experiment ? Math.max(0, slots - 1) : slots;
  const out: Array<{ ideaId: string | null; hook: string; experiment: boolean }> = pool.slice(0, n).map((i) => ({ ideaId: i.ideaId, hook: i.hook, experiment: false }));
  if (experiment) out.push({ ideaId: null, hook: experiment, experiment: true });
  return out;
}

export interface Slot { day: number; film: { start: number; end: number }; edit: { start: number; end: number } | null; post: { at: number; hour: number; fromHistory: boolean }; ideaId: string | null; hook: string; experiment: boolean }

/**
 * Lay the week out. `filmDays` are local weekday numbers they tend to film on (0 = Sunday)
 * from the dossier; empty means spread evenly. The post time comes from the model; the
 * post must land after the edit (or the film when there is no edit). Pure.
 */
export function draftWeek(input: {
  now: number;
  timeZone: string;
  postsPerWeek: number;
  filmDays: number[];
  filmHour: number | null;
  editMinutes: number;
  busy: Busy[];
  model: PostTimeModel;
  ideas: Array<{ ideaId: string | null; hook: string; experiment: boolean }>;
}): Slot[] {
  const slots = Math.max(PLAN.minSlots, Math.min(PLAN.maxSlots, Math.round(input.postsPerWeek) || 1));
  const day0 = input.now + 86_400_000; // the plan starts tomorrow
  const dayEpochs = Array.from({ length: 7 }, (_, i) => day0 + i * 86_400_000);
  const weekday = (e: number) => new Date(new Intl.DateTimeFormat("en-US", { timeZone: input.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(e)).getDay();
  // Preferred days first, then fill evenly across what is left.
  const preferred = dayEpochs.filter((e) => input.filmDays.includes(weekday(e)));
  const rest = dayEpochs.filter((e) => !input.filmDays.includes(weekday(e)));
  const evenly = (xs: number[], k: number) => (k <= 0 ? [] : xs.filter((_, i) => i % Math.max(1, Math.floor(xs.length / k)) === 0).slice(0, k));
  const days = [...preferred.slice(0, slots), ...evenly(rest, slots - Math.min(slots, preferred.length))].slice(0, slots).sort((a, b) => a - b);

  const busy = [...input.busy];
  const out: Slot[] = [];
  input.ideas.slice(0, slots).forEach((idea, i) => {
    const day = days[i] ?? dayEpochs[i % 7];
    const film = freeSlotOn(day, PLAN.filmMinutes, busy, input.filmHour ?? PLAN.defaultFilmHour, input.timeZone);
    if (!film) return;
    busy.push(film);
    let edit: Slot["edit"] = null;
    if (input.editMinutes > 0) {
      // Straight after filming if the gap is there, else the next morning.
      const direct = freeSlotOn(day, input.editMinutes, busy, localHour(film.end, input.timeZone), input.timeZone);
      edit = direct && direct.start >= film.end ? direct : freeSlotOn(day + 86_400_000, input.editMinutes, busy, 9, input.timeZone);
      if (edit) busy.push(edit);
    }
    const after = edit ? edit.end : film.end;
    const post = nextPost(input.model, after, input.timeZone);
    out.push({ day, film, edit, post, ideaId: idea.ideaId, hook: idea.hook, experiment: idea.experiment });
  });
  return out;
}

function nextPost(model: PostTimeModel, after: number, timeZone: string): Slot["post"] {
  const candidates = model.hours.length ? model.hours.map((h) => h.hour) : [model.defaultHour];
  const fromHistory = model.hours.length > 0;
  const nowHour = localHour(after, timeZone);
  for (const hour of candidates) if (hour > nowHour) return { at: atLocalHour(after, hour, timeZone), hour, fromHistory };
  return { at: atLocalHour(after + 86_400_000, candidates[0], timeZone), hour: candidates[0], fromHistory };
}
