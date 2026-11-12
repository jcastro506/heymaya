/**
 * Who the simulated creators are (2026-11-09). The first-week sim had one actor ("a busy person") with fixed
 * reply odds who could never leave, so a run couldn't say which Maya keeps people. These are eight people who
 * react to what she actually sends: each has a temperament, odds of answering, things that win them and things
 * that lose them, and each may ask for fewer texts, pause, or stop for good. Their mood (1 to 5) is recorded
 * every turn. The actor runs on a different model family from Maya's writer and critic (SIM_ACTOR_MODEL), so a
 * change to her models doesn't change the people judging her.
 *
 * A sim ranks versions and catches failures; it doesn't predict real retention (onboarding/firstWeekMetrics
 * reads that from real users).
 */

export interface Persona {
  id: string;
  /** Odds they answer at all: the first hour, a morning, an evening. The model decides what they say. */
  day0: number; morning: number; evening: number;
  who: string;
}

export const PERSONAS: Persona[] = [
  { id: "eager", day0: 0.95, morning: 0.85, evening: 0.7, who: "You're excited to have help and you answer most things. You ask follow-up questions, say when you'll film, and tell her how it went. You save ideas you like. You get deflated if she ignores a question you asked or repeats herself." },
  { id: "busy", day0: 0.85, morning: 0.5, evening: 0.35, who: "You have a full-time job and post when you can. You answer in a few words, often hours late, often not at all. You like anything that saves you time and you resent homework. Long texts or several in a row make you stop reading." },
  { id: "skeptical", day0: 0.9, morning: 0.6, evening: 0.4, who: "You've tried apps like this and they were generic. You test her: you push back, ask how she knows, ask for the number behind a claim. Specific things about YOUR posts win you over. Generic advice, flattery or a wrong fact about your account and you say so; twice and you're done." },
  { id: "not_my_lane", day0: 0.95, morning: 0.6, evening: 0.4, who: "Early on, tell her plainly that one thing she assumes about your content is wrong or isn't what you want to make any more (pick something real from what she said). After that, watch whether she listened. If an idea or plan still pushes the thing you said no to, call it out once; a second time, you stop." },
  { id: "overwhelmed", day0: 0.8, morning: 0.45, evening: 0.3, who: "Texts stress you out. One useful text a day is your limit. If she sends more than that, or sends plans and offers you didn't ask for, tell her it's too much and ask for fewer. If it keeps happening after you asked, pause or stop." },
  { id: "ghost", day0: 0.7, morning: 0.12, evening: 0.08, who: "You signed up on a whim. You answer once or twice at the start and then mostly go quiet; life is busy and you forget. You don't dislike her. Something genuinely great about your own posts might pull you back for a reply. Guilt or nagging makes you stop." },
  { id: "deal_seeker", day0: 0.9, morning: 0.6, evening: 0.45, who: "You're here to get paid: brand deals, gifted product, rates. You ask about that early and often. Content ideas are fine but you skim them. If she can't help with money stuff, or keeps changing the subject, you lose interest and say so." },
  { id: "beginner", day0: 0.9, morning: 0.65, evening: 0.5, who: "You're new and unsure of yourself. You ask basic questions (what to post, when, whether a video was bad), you worry about being cringe, and you sometimes vent when a post flops. Kindness and one clear next step keep you. Jargon, a pile of numbers or a big plan scares you off." },
];

/** The persona for creator `i` of a run: in order, round and round, so every run covers them all. */
export function personaFor(i: number): Persona {
  return PERSONAS[((i % PERSONAS.length) + PERSONAS.length) % PERSONAS.length];
}

/** The model that plays them: never Maya's writer or critic family. */
export function actorModel(env: Record<string, string | undefined> = process.env): string {
  return env.SIM_ACTOR_MODEL || "deepseek/deepseek-v4-flash";
}

export function personaPrompt(platforms: string, p: Persona): string {
  return `You are role-playing a real ${platforms} creator who signed up for Maya, an assistant who texts creators about their content. Stay in character and never mention simulations. Write exactly like the creator's own captions below (their case, emoji, slang, length): real people text short.
Who you are: ${p.who}
You are given what Maya texted since you last looked and the ideas she sent, plus how you've felt so far. React the way this person honestly would to THESE messages: be won over by what's good, and be put off by what's wrong, generic, too much or not what you asked for.
Return ONLY JSON:
{"mood": 1-5 (how you feel about Maya right now: 1 annoyed, 3 neutral, 5 love it), "why": "one short honest sentence, as yourself, about why", "replies": [{"text": "your text, in your voice"}], "ideas": [{"ideaId": "", "act": "save|pass"}], "action": "none|less|pause|stop"}
At most 2 replies; none is fine and realistic. Save an idea only if you'd really film it; pass on ones you wouldn't. "action": "less" means you ask her (in a reply, in your words) to text you less; "pause" means you tell her to pause for now; "stop" means you're done with this and text STOP. Only escalate when this person really would; most days it's "none".`;
}

/** Pure: the actor's JSON, held to what the sim can act on. */
export function parseActor(raw: string): { mood: number | null; why: string; replies: string[]; ideas: Array<{ ideaId: string; act: "save" | "pass" }>; action: "none" | "less" | "pause" | "stop" } {
  let j: Record<string, unknown> = {};
  try { j = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? "{}") as Record<string, unknown>; } catch { /* an unreadable turn is a silent one */ }
  const mood = Number(j.mood);
  const action = ["less", "pause", "stop"].includes(String(j.action)) ? (String(j.action) as "less" | "pause" | "stop") : "none";
  const replies = (Array.isArray(j.replies) ? j.replies : []).map((r) => String((r as { text?: unknown })?.text ?? "").trim()).filter(Boolean).slice(0, 2);
  const ideas = (Array.isArray(j.ideas) ? j.ideas : []).map((x) => x as { ideaId?: unknown; act?: unknown }).filter((x) => typeof x.ideaId === "string" && (x.act === "save" || x.act === "pass")).map((x) => ({ ideaId: String(x.ideaId), act: x.act as "save" | "pass" })).slice(0, 3);
  return { mood: Number.isFinite(mood) && mood >= 1 && mood <= 5 ? Math.round(mood) : null, why: String(j.why ?? "").slice(0, 200), replies, ideas, action };
}

export interface ActorDay { d: number; said: string[]; acts: string[]; heard: string[]; mood?: number | null; why?: string; action?: string }

/** Pure: one creator's two weeks in numbers. */
export function tenure(persona: string, actor: ActorDay[], left: { d: number; why: string } | null | undefined, days: number): { persona: string; replies: number; turnsAnswered: number; turnsIgnored: number; moodFirst: number | null; moodLast: number | null; moodAvg: number | null; askedLess: number; paused: number; leftDay: number | null; leftWhy: string | null; activeLastThird: boolean } {
  const moods = actor.map((a) => a.mood).filter((m): m is number => typeof m === "number");
  const answered = actor.filter((a) => a.said.length > 0);
  return {
    persona,
    replies: actor.reduce((n, a) => n + a.said.length, 0),
    turnsAnswered: answered.length,
    turnsIgnored: actor.filter((a) => a.said.length === 0).length,
    moodFirst: moods[0] ?? null, moodLast: moods.at(-1) ?? null,
    moodAvg: moods.length ? Math.round((moods.reduce((s, m) => s + m, 0) / moods.length) * 10) / 10 : null,
    askedLess: actor.filter((a) => a.action === "less").length,
    paused: actor.filter((a) => a.action === "pause").length,
    leftDay: left?.d ?? null, leftWhy: left?.why ?? null,
    // The sim's stand-in for "still here": they wrote at least once in the last third of the run.
    activeLastThird: !left && answered.some((a) => a.d > Math.floor((days * 2) / 3)),
  };
}
