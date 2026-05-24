---
name: maya-x-founder-led-researcher
description: Find X founder-led conversations, reply targets, hooks worth modeling, and accounts worth a private List.
---

# maya-x-founder-led-researcher

## Purpose

For technical / indie / B2B SaaS / dev-tool products, X is the highest-leverage cold-start channel — but ~80% of pre-1K-follower acquisition comes from replies, not posts (x.md § 3). This skill finds buyer-intent reply targets, models hook patterns, and proposes a 20-40-handle private List.

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
4. **x.md rule 10 reply-target quality bar.** ≥5 likes on OP tweet, <48h old, OP has >50 followers, OP not a bot. Skip if any miss.
5. **Sweet-spot timing.** Prefer 10-50 likes, <6h old, <20 existing replies (x.md § 3).
6. **x.md rule 9 first-reply NO-URL.** No URL in first reply. URL goes in follow-up if OP engages.
7. **Three-paragraph reply structure required.** Validation → value-add → soft mention. Product mention in paragraph 1 = regenerate.
8. **List composition.** 20-40 accounts in niche, 5K-100K followers each, posting weekly+. From x.md § 1 + ScrapeCreators discovery. Do NOT auto-follow.
9. **Hook modeling.** Pull 3-5 high-engagement hooks; map to x.md § 5 (1-15). Reject if matches anti-patterns (§ 7) or hype-language (rule 11).
10. **Black-Magic platform-risk reminder.** IF operator's product depends on free X API access THEN `platformRiskWarning: true` (x.md § 11 Failure 4).
11. **Account silence recovery.** IF `lastPostAgeDays > 7` THEN first action = value-add reply, not build-update post.
12. **Citation-firewall on numbers.** Every number Maya quotes must come from a fresh ScrapeCreators call or operator-confirmed state.

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
    matchesIcp: string;
    draftReply: { p1: string; p2: string; p3SoftMention: string };
    urlInFollowupOnly: true;
  }>;
  hookExamples: Array<{ tweetUrl: string; handle: string; likes: number; hookText: string; pattern: string; whyItWorks: string }>;
  recommendedList: Array<{ handle: string; nicheFit: string; followerCount: number; postingCadence: "daily" | "weekly" | "monthly"; source: "x.md-anchor" | "scrapecreators-discovery" }>;
  searchQueries: string[];
  platformRiskWarning?: boolean;
  parkReasons?: string[];
}
```

## Failure modes

- **Operator <100 followers + wants a launch thread.** Refuse. Return Phase 1 routine + ClearNoteLab failure citation (x.md § 11 Failure 1).
- **Niche has no English-language activity on X.** Park. Surface to channel-judge.
- **All reply targets are from other founders.** Skip-launch risk. Re-query with sharpened ICP probes.
- **ScrapeCreators X endpoints fail.** Fall back to `mvanhorn/xai` Grok search if budget allows. Cap Grok at 5 calls/user/day.

## Cost discipline

Max 6 ScrapeCreators calls. Grok max 3 calls if invoked. 1 hard_research_beta + 1 main_maya. Timeout 15 min.

## Anti-slop check

Every `draftReply.p1/p2/p3SoftMention` MUST pass `maya-slop-critic` before this skill returns. Specifically ban hype emoji, "Great post!" / "So true!", "Excited to share". Mirror operator's last-5 authentic-post voice.
