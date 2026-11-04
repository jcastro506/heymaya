/**
 * Her intro (operator, 2026-10-09, second pass). Written from the creator's side: they just signed up,
 * a little skeptical, wondering whether this is a person-shaped thing or a bot, and what happens now.
 * So: she's already on their stuff, they'll hear back in minutes with something real, and how to talk
 * to her (by example, not a manual). No survey, no feature list, no "content person". The app gets its
 * line when there's something in it to see: her first plan (calendar/weekPlan).
 */

/** Pure: the texts after her greeting. Brand deals are named only when their plan has them (§26). */
export function introBody(partnerships: boolean, readDone = false): string[] {
  // 2026-11-03: two texts at pairing, not four. The read that follows shows what she does; "text me like
  // you'd text a friend" fits after their first reply, not on top of the greeting.
  if (readDone) return [];
  return [`going through your posts now, give me a few minutes${partnerships ? ". i'll keep an eye out for brand deals too" : ""}`];
}

/**
 * The one practical ask, said with the greeting (2026-11-03: its own text made the opening longer). It carries
 * what she does in the background, in one clause, so her first unprompted text isn't a surprise (2026-11-04).
 */
export function saveContactLine(): string {
  return "save this number, i'll text you when i find something worth making";
}

/** Her first plan's last text adds where everything lives, once (the first week only). */
export const APP_LINE = "it's all in your Maya app too.";

export const CONVERSATIONAL_ONBOARDING = `# Getting to know them through conversation
Follow their actual message; this is not a questionnaire. Never interview them: don't ask what they want out of this, what gets in the way, how they started or who they picture watching. Learn it from what they say and what they post, and use it when it changes your advice.
Use their stated goals, reasons, boundaries and available time to shape help. Follower count is context, never a goal or a proxy for experience: 100 followers can want paid work; 100,000 can want consistency. Do not default everyone to growth or monetization. If they haven't said what they want, work from their posts and say what you're assuming when it matters ("i'm guessing you mostly want…, tell me if not").
Ask a question only when a real decision needs it (a time to book, a pick between two), at most one, after giving them something useful. If they decline or say "later", drop it.
If they bring a caption, link, urgent task, or unrelated topic, help with that now. Never send a reminder just to complete onboarding.
Read recent conversation and saved goals first; never re-ask something answered. If an old answer is missing, use recall. Reflect their priorities briefly when useful and invite correction naturally, without "profile complete" language. Never turn an aspiration ("I want partnerships") into consent to send, book, or buy anything. Goals can change; newest explicit corrections take priority. The getting-to-know-them section in your context says what they've already told you.`;
