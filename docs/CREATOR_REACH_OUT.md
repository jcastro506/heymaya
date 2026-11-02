# When Maya texts first

2026-10-09. The first tester found her annoying: two filler texts the morning after a great first night, then "stop". She had about fifteen reasons to text first, each on its own timer, and one shared cap of 3 a day that half of them skipped.

## The rule

She texts first only when a friend who works in the industry would:

1. **They asked for it.** A routine ("send me 3 ideas every morning", "comment picks at noon") runs exactly as asked until they say stop. Booked-session reminders and the Sunday plan count as asked.
2. **Their own stuff, today.** A shoot today, a missed one yesterday, "how'd it go?", their post taking off, a brand replied.
3. **She has something good.** One idea she'd say "you have to make this" about, a callback to something they told her, a milestone, a nudge after days of silence.

Everything else goes to the app quietly. New ideas are never announced one by one.

## One attention budget (2026-11-02; enforced in `messages.send`, one definition in `core/reachOut.ts`)

Before, four rules decided separately (these lanes, the editor's hold, the daily cap, the phone rail's silence ladder). Together they gave a paying tester eight days of nothing: three unanswered texts meant "quiet until they write", which held the Sunday plan and every deal. Now one function decides, on every channel.

| lane | kinds | budget |
|---|---|---|
| asked | routine, reminder, plan, review | none (still quiet hours, pause, "hold on") |
| setup | hello, first read, onboarding notices in the first days | none |
| theirs | morning, shoot_today, missed, checkin, saw_it, post_read, event_today, partnership, calendar | 2 a day while they're talking to her (wrote in the last 3 days); after that, budgeted like hers |
| hers | everything else | by how they've been answering, below |

| their state | texts she starts |
|---|---|
| day one (first 24 h) | two of hers: the first idea, one later that day |
| engaged (0–1 unanswered) | one a day at their pace (less = one in 3 days, more = two a day); never a second while the first is unanswered, until the next day |
| cooling (2–3 unanswered) | one every 3 days |
| quiet (4+ unanswered) | one a week. Never zero: someone paying hears her best thing weekly |

Never more than 3 started in a day. The phone rail (`core/phoneRail.ts`) now only holds for the line's health (opted out, critical, at risk).

What goes in that one text is the editor's pick (`core/editor.ts`): for Maya + Deals, a deal scores 1.5× (it's what they pay for). The editor skips its model call when the budget would hold the text anyway.

The weekly plan goes only to people who use plans: in their first two weeks, or once they've booked a block of one; anyone can ask for one. A plan held at send drops its blocks, so the app never shows shoots nobody was told about. The scout drafts a new idea every few days instead of daily for someone who hasn't opened one in a week and isn't answering.

## One burst, one reply (2026-11-02, `core/burst.ts`)

People text in bursts. Her turn waits a few seconds after their last text (7 s, 10 s for a video); an older turn with a newer text behind it is skipped and the newest answers everything since her last reply (never past 3 minutes, so a long burst still gets answers). A reply being written when they text again is held in `messages.send`. Videos in a burst are watched side by side, and the draft review answers what they asked: a sound question gets a sound; captions only when asked, or one caption when there's no question. "hold on" / "stop texting for a minute" withdraws everything of hers not yet delivered, she says one short line, and she starts nothing until they write. The answer to a burst is still one to three short texts.

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

- **Trends (2026-10-13, `scout/trends.ts`):** a trend she judged right for them becomes a candidate only while it's early (first seen under 4 days ago, not slowing), scored above an idea when people in their own lane are on it. It competes for the same one text; everything else waits in the app's Trending tab. Asked in Messages ("any trends?"), she answers from `trends_now` and never names a trend a tool didn't give her.

- **2026-10-21, after a tester's first week** (3 silent days, 0 of 3 texts answered, 6 ideas never opened, a deal that expired unsent):
  - **No quiet start.** Her finds go from day one, still one a day at normal pace.
  - **Ideas waiting:** 3+ new ideas they haven't seen and nothing opened in 3 days becomes one candidate that names her favorite. Those ideas then count as offered, so it never repeats.
  - **Post read:** 18–48 h after they post (any post that isn't a win) she gives an honest read in the `theirs` lane: what worked, and the one thing to try if it's below their usual.

Simulated month (`core/__tests__/editor.test.ts`): someone who answers comments gets comments and quiet days; someone who answers ideas learns to get ideas; someone who answers nothing gets about one a week.
