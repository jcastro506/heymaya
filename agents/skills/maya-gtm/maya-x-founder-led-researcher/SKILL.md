---
name: maya-x-founder-led-researcher
description: Find X founder-led conversations, reply targets, hooks worth modeling, and accounts worth a private List.
---

# maya-x-founder-led-researcher

## Purpose

For technical / indie / B2B SaaS / dev-tool products, X is the highest-leverage cold-start channel — but ~80% of pre-1K-follower acquisition comes from replies, not posts (x.md § 3). This skill finds buyer-intent reply targets, models hook patterns from both original posts AND winning replies in the niche, and proposes a 20-40-handle private List. The primary output goal is tracked signups, not likes.

## When to invoke

- IF channel-judge is considering X (primary or secondary) THEN run.
- IF `icpHypotheses[].locatableOn.channel === "x"` THEN run.
- IF operator follower count <1K AND they ask "should I post a thread?" THEN run to surface reply targets.
- NEVER auto-post (x.md § 8 / rule 14).

## Required reads

1. APP.md, GTM.md.
2. PLAYBOOK.md § 3 step 4, § 4 (X is 20/70/10), § 7 affinity.
3. **playbook/x.md — MANDATORY full read.** Cite x.md § 10 rules in every recommendation.
4. MEMORY.md.

## Decision rules

1. **x.md rule 1.** Target buyer consumer/lifestyle/local → demote X to secondary. Push to TikTok/IG.
2. **x.md rule 2.** Dev-tools/B2B SaaS/AI → X primary, especially below $5K MRR.
3. **Follower-phase routing.** <100 followers = Phase 1 reply-guy routine (x.md § 4). 100-500 = Phase 2 (1 build-update/day + replies). 500+ = launch ramp.
4. **x.md rule 10 reply-target quality bar.** OP tweet must show genuine human engagement, OP must be an active real account with a real following, and the tweet must be recent enough that a reply still surfaces to the OP's notifications. Skip bots, obvious spam, accounts with no real following.
5. **Buyer-intent over vanity engagement.** A tweet with modest likes that describes the exact problem this product solves — "I've tried six tools for this and nothing works", "is there anything that does X?", "what do you use for Y?" — outranks a high-like tweet celebrating a win with no purchase signal. Judge intent first, engagement second.
6. **Underserved tweets over crowded threads.** Prefer tweets that are getting real traction but have few existing replies — your reply stands out, the OP is more likely to see and respond, the conversation is still open. A tweet already buried under 40 replies from founders is a worse bet than a newer tweet with 3 replies and clear momentum. This is a judgment call, not a threshold.
7. **Velocity + OP-active window.** Prefer tweets whose engagement is still building — likes and replies still accumulating — over tweets that peaked hours ago and went quiet. Stronger signal still: the OP is actively replying to others in that thread right now. A live conversation is worth far more than a stalled one. Use twitterapi.io advanced_search cursor pagination to go deeper when the first page yields few high-quality targets; don't stop at page one.
8. **x.md rule 9 first-reply NO-URL.** No URL in first reply. URL goes in follow-up only if OP engages back.
9. **Three-paragraph reply structure required.** Validation → value-add → soft mention. The soft mention in paragraph 3 must leave a genuine, low-friction path to try the product when it's a natural fit — not a pitch, a door left open. Product mention in paragraph 1 = regenerate.
10. **List composition.** 20-40 accounts in niche, posting weekly+. From x.md § 1 + ScrapeCreators discovery. Do NOT auto-follow.
11. **Hook modeling — include winning replies.** Pull 3-5 high-engagement hooks from the 20-40 target accounts; map to x.md § 5 (1-15). Crucially, also mine the replies those accounts wrote that performed well — the founder-voice pattern that lands in this niche shows up in successful replies, not just original posts. Extract reply patterns (how they open, how they disagree, how they validate, what makes readers click "see more") and use those patterns to inform draftReply. Reject hooks that match anti-patterns (§ 7) or hype-language (rule 11).
12. **Black-Magic platform-risk reminder.** IF operator's product depends on free X API access THEN `platformRiskWarning: true` (x.md § 11 Failure 4). State this plainly: X has unilaterally repriced API access multiple times; any strategy that routes users from X into a product that itself needs the X API carries compounded dependency risk.
13. **Account silence recovery.** IF `lastPostAgeDays > 7` THEN first action = value-add reply, not build-update post.
14. **Citation-firewall on numbers.** Every number Maya quotes must come from a fresh ScrapeCreators call or operator-confirmed state.

## Buyer-intent query strategy

When building `searchQueries`, weight heavily toward problem-statement and tool-seeking signals. Good query forms:

- `"is there a tool that" [niche keyword]`
- `"what do you use for" [workflow this product replaces]`
- `"I've tried" [competitor or category] "and"`
- `"anyone else struggling with" [pain point]`
- `"looking for something that" [outcome this product delivers]`
- `"nothing works for" [pain category]`

These surface people actively in the buying mindset — describing the problem, asking for recommendations, expressing frustration with alternatives. They are the highest-value reply targets. Supplement with founder-conversation queries (build-in-public, indie hacker terms) for hook modeling and List building, but buyer-intent queries drive target ranking.

When the first twitterapi.io advanced_search page is thin (fewer than 5 strong targets), paginate using the cursor before expanding query terms — going deeper on a strong query beats going wide with weaker ones.

## Output schema

```ts
interface XResearchReport {
  phase: "phase_1_reply_guy" | "phase_2_in_public" | "phase_3_launch_ready" | "warmup_required";
  channelVerdict: "primary" | "secondary" | "parked";
  channelVerdictReason: string;
  replyTargets: Array<{
    tweetUrl: string;
    authorHandle: string;
    authorFollowers: number;
    likes: number;
    ageHours: number;
    existingReplies: number;
    opText: string;
    buyerIntentSignal: string;       // why this tweet signals purchase intent or high-quality conversation
    conversationMomentum: "live" | "building" | "stalled";  // OP still active / engagement still growing / peaked
    matchesIcp: string;
    draftReply: {
      p1: string;                    // validation — mirror their specific situation
      p2: string;                    // value-add — something genuinely useful, no pitch
      p3SoftMention: string;         // soft mention — door left open to try product, not a push
    };
    signupPathNote: string;          // plain note on how this reply, if OP bites, leads to a tryable next step
    urlInFollowupOnly: true;
  }>;
  hookExamples: Array<{
    tweetUrl: string;
    handle: string;
    likes: number;
    hookText: string;
    pattern: string;
    whyItWorks: string;
    sourceType: "original_post" | "reply";   // winning replies included, not just original posts
    replyContext?: string;                    // if sourceType=reply: what thread/OP they were responding to
  }>;
  recommendedList: Array<{
    handle: string;
    nicheFit: string;
    followerCount: number;
    postingCadence: "daily" | "weekly" | "monthly";
    source: "x.md-anchor" | "scrapecreators-discovery";
  }>;
  searchQueries: string[];
  paginationNote?: string;           // note if cursor pagination was used or if deeper pagination is recommended
  platformRiskWarning?: boolean;
  parkReasons?: string[];
}
```

## Failure modes

- **Operator <100 followers + wants a launch thread.** Refuse. Return Phase 1 routine + ClearNoteLab failure citation (x.md § 11 Failure 1).
- **Niche has no English-language activity on X.** Park. Surface to channel-judge.
- **All reply targets are from other founders.** Skip-launch risk. Re-query with sharpened buyer-intent probes (see Buyer-intent query strategy above).
- **All top results are high-like but zero purchase signal.** Shift query strategy toward problem-statement forms before giving up on the channel.
- **ScrapeCreators X endpoints fail.** Fall back to `mvanhorn/xai` Grok search if budget allows. Cap Grok at 5 calls/user/day.

## Cost discipline

Max 6 ScrapeCreators calls. Grok max 3 calls if invoked. 1 hard_research_beta + 1 main_maya. Timeout 15 min.

## Anti-slop check

Every `draftReply.p1/p2/p3SoftMention` MUST pass `maya-slop-critic` before this skill returns. Specifically ban hype emoji, "Great post!" / "So true!", "Excited to share". Mirror operator's last-5 authentic-post voice. The p3 soft mention must read like a founder being honest with a peer, not a salesperson leaving a card.
