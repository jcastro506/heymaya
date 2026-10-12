# When Maya texts first

2026-10-09. The first tester found her annoying: two filler texts the morning after a great first night, then "stop". She had about fifteen reasons to text first, each on its own timer, and one shared cap of 3 a day that half of them skipped.

## The rule

She texts first only when a friend who works in the industry would:

1. **They asked for it.** A routine ("send me 3 ideas every morning", "comment picks at noon") runs exactly as asked until they say stop. Booked-session reminders and the Sunday plan count as asked.
2. **Their own stuff, today.** A shoot today, a missed one yesterday, "how'd it go?", their post taking off, a brand replied.
3. **She has something good.** One idea she'd say "you have to make this" about, a callback to something they told her, a milestone, a nudge after days of silence.

Everything else goes to the app quietly. New ideas are never announced one by one.

## Budgets (enforced in `messages.send`, one definition in `core/reachOut.ts`)

| lane | kinds | budget |
|---|---|---|
| asked | routine, reminder, plan, review | none (still quiet hours and pause) |
| setup | hello, first read, onboarding notices in the first 24 h | none |
| theirs | morning, shoot_today, missed, checkin, saw_it, event_today, partnership | 2 a day |
| hers | scout, idea, for_you, milestone, streak, nudge, quiet, breakout, engage, status | their pace: less = 1 in 3 days, normal = 1 a day, more = 2 a day; none in the first 3 days |

A day never has more than 3 texts she started, outside what they asked for.

## Cut or folded

- "Behind today" and "couldn't see TikTok" notices: never texted (logged for the operator).
- The day-two "send me a draft" invite: said once, in the intro.
- "Want me to watch @x?": she adds them quietly while their list is short.
- The daily comment picks: only as a routine they turn on.

## Their controls, in chat

- "text me less" / "you can text me more": `texting_pace`.
- "every morning send me…": `routine_add`; "stop the morning ideas": `routine_stop`.

## The intro

No survey. She says who she is, what she does, how to use her, that the app keeps everything, and asks them to save her number. Then her read.

## The editor: one pick a day (2026-10-12, `core/editor.ts`)

Her own finds no longer race each other. The paths that find things write **candidates** to `creators.noticed` (the scout's drafted ideas, including their own post doing well and creators they watch; "thought of you"), and comments on their posts (questions, or liked ones) are read at pick time.

- **Score (code):** base by kind × freshness × how often this person answers that kind (answered = a reply within 8 h) × variety (the same kind as last time loses).
- **Pick (her):** the top 4, with what she sent this week and whether it landed, go to her. She picks one or none ("a quiet day is a good answer"). Comments are written by her and checked; a failed check is a quiet day.
- **When:** from the hour they actually reply (learned nightly, `preferredSendHour`) until 8pm. Not within 3 h of their last message: mid-conversation it rides along in her reply as one "oh also" bubble, which decides the day with no extra text.
- **Backing off:** three of hers unanswered → only a strong one, or one good one a week, never two days running.
- **Sunday is one text:** the review opens next week's plan (alone only when the week can't be planned).

Simulated month (`core/__tests__/editor.test.ts`): someone who answers comments gets comments and quiet days; someone who answers ideas learns to get ideas; someone who answers nothing gets about one a week.
