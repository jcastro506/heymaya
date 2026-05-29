---
name: maya-voice-matcher
description: Score how well a drafted reply/post/thread matches the operator's actual voice — drawn from their existing public writing (X/Reddit/LinkedIn) or onboarding answers as fallback. Combines with maya-slop-critic for a final ship-or-revise gate. Each gtmDraftedContent row gets a voiceMatchScore + slopCriticPassed flag.
---

# maya-voice-matcher

## Purpose

When subagents (reddit_research, x_research, etc.) draft replies to surface as user-facing content, the drafts default to LLM-tone. Two failure modes show up:
1. **AI slop** — banned phrases ("game changer," "unlock," "supercharge"), MBA-deck cadence, fake certainty.
2. **Off-voice** — technically correct content that doesn't sound like the operator. Friends would clock it as bot output.

This skill is the pre-publish quality gate. Every draft goes through it before the calendar-populator surfaces it as an actionable event. Failed drafts go back to the originating subagent for a rewrite.

## When to invoke

- IF a `_research` subagent just landed a gtmDraftedContent row THEN run on it.
- IF the operator rejected a previous draft with feedback ("too formal") THEN re-run with that feedback in the voice profile.
- IF format-market-fit shifts (Phase 4 detection) THEN re-score the cadence library against the new winning format's voice.

## Required reads

1. **USER.md** — operator's name, constraints, founderWhy (their own words for why they built it — strong voice signal).
2. **SOUL.md** — Maya's voice contract for the operator-facing layer; ban list applies to drafts that will ship as the operator's content.
3. **PLAYBOOK.md § 6** — Anti-slop section. The canonical ban list.
4. **gtmDraftedContent row** for the draft being scored.
5. **Any prior approved drafts** for the same platform (the live voice fingerprint).
6. **Operator's existing public writing** — the founder's OWN real posts. In manager mode these were **ingested during onboarding (APP.md Phase 0 / existing-account ingestion)** and are already on disk; otherwise pull via Composio (last 20 X tweets, last 10 Reddit comments, last 5 LinkedIn posts). Highest-fidelity voice source. Prefer same-platform samples.
7. **Venue style exemplars** (`styleExemplars[]` from the per-channel research skill for this platform): 5-10 real top-performing HUMAN native posts captured verbatim from the exact venue. The register anchor — what "native here" sounds like. Match cadence/vocab/length/format; never copy content.

## Decision rules

### 1. Build the voice fingerprint — condition on BOTH the founder's own posts AND the venue exemplars

The match is conditioned on two independent anchors. A draft that sounds like the founder but ignores how the venue talks reads out of place; a draft that nails the venue register but isn't in the founder's voice reads ghost-written. The target is the **intersection**: the founder's voice, expressed in a register native to this specific venue.

**Anchor A — the founder's OWN real posts (the voice anchor).** Where the founder already has accounts, **manager mode ingested their real posts during onboarding (APP.md Phase 0 / existing-account ingestion)** — this is the highest-fidelity source and is already on disk; you don't have to re-pull it. Input tiers, in order of preference:

1. **Founder's ingested / existing public writing** (highest signal). The manager-mode Phase 0 ingestion captured their real posts per platform; where it didn't (or to supplement), pull the operator's last N posts via Composio. Look for: average sentence length and its *variance* (burstiness), contraction usage, technical-vs-casual register, characteristic phrases, how they open and sign off, em-dash habit, single-sentence-paragraph habit, profanity tolerance, emoji frequency. Note 5-8 distinctive features. **Prefer same-platform samples** — how the founder writes on X is not how they write on LinkedIn.

2. **Approved prior drafts** (medium signal). Use the operator's accept/reject history on previous drafts as a voice signal. Drafts the operator approved unchanged represent voice fit. Drafts the operator EDITED tell you what to avoid.

3. **Onboarding answers + USER.md `founderWhy`** (lowest signal, but always available). Their own answers about why they built the product capture their natural tone. Use as fallback when 1+2 are empty.

**Anchor B — the venue style exemplars (the register anchor).** The per-channel research skills (`maya-reddit-demand-researcher`, `maya-x-founder-led-researcher`, `maya-linkedin-fit-researcher`, `maya-tiktok-format-researcher`, `maya-content-format-miner`) each capture **5-10 real, top-performing, HUMAN native posts verbatim from the exact venue** as style exemplars (`styleExemplars[]`). These are the few-shot voice/register anchors: they encode the cadence, vocabulary, length, and format a real participant in *this specific subreddit / niche / feed* uses. Read them. Match cadence/vocab/length/format — **never copy their content** (that's plagiarism and a slop tell in itself). They tell you what "native here" sounds like; Anchor A tells you what "the founder" sounds like.

**When the two conflict** (founder writes long essays, the venue rewards 2-line replies): bend register toward the venue, keep voice (word choice, stance, characteristic phrases) toward the founder. Note the tension in `userFeedback` so the operator can confirm.

### 2. Score each draft on three dimensions

For every draft, produce three numeric scores in [0,1]:

- **Slop score** (PLAYBOOK § 6 ban list compliance). 1.0 = no banned phrases, no MBA-deck structure, no AI-paragraph rhythm. <0.7 = fail.
- **Voice match** (fingerprint similarity to Anchor A — the founder's own posts). 1.0 = reads like the operator wrote it. Compare sentence length distribution and burstiness, vocabulary, characteristic phrases, stance. <0.6 = fail.
- **Native-register fit** (similarity to Anchor B — the venue style exemplars). 1.0 = reads like a real participant in this exact venue wrote it (right length, cadence, format, vocabulary for the subreddit/niche/feed). A grammatically perfect post that's the wrong shape for the venue fails here. <0.6 = fail. (When exemplars are unavailable for the venue, default this dimension to neutral 0.5 and note it.)
- **Specificity** (concrete-vs-generic ratio). Drafts referencing specific URLs / numbers / proper nouns from the source thread score higher. Drafts that could be sent to any product score lower. <0.5 = fail.

Combine the four dimensions into a single `voiceMatchScore` using judgment (this is a weighting heuristic for the score field, not a hard gate): roughly `0.3*voice + 0.25*nativeRegister + 0.3*specificity + 0.15*slop`, but let the lowest dimension dominate — a draft that aces voice and specificity but is the wrong shape for the venue (low native-register) should not score "ship." Persist in `gtmDraftedContent.voiceMatchScore`.

### 3. Slop-critic pass

Run `maya-slop-critic` (existing skill) on draftText + every draftSegments entry. Collect all banned-phrase hits + structural critiques.

- `slopCriticPassed: true` if zero hits AND structural critique empty.
- `slopCriticPassed: false` otherwise. Populate `slopCriticFailures: string[]` with the specific reasons.

### 4. Routing

After scoring:
- **All-pass (voiceMatchScore ≥ 0.7 AND slopCriticPassed)** → mark `approvalState: "pending_approval"`. The calendar-populator picks it up. Operator sees it in Telegram queue.
- **Voice fail only (slopCriticPassed but voiceMatchScore < 0.7)** → revise. Send back to originating subagent with feedback: "Tone shift — these specific edits to match founder's voice." Re-spawn subagent with the edit instructions.
- **Slop fail** → revise. Send specific banned phrases that triggered the fail. Re-spawn subagent.
- **Both fail** → drop the draft entirely (mark `approvalState: "rejected"`, `userFeedback: "auto-rejected: slop + off-voice"`). Surface to user via Telegram only if the target thread is unique enough to be worth flagging.

### 5. Voice contract enforcement

This skill itself produces user-facing content (the voice fingerprint may surface in operator messages). Apply SOUL.md voice contract:
- **OK to say**: "I tightened a few things — your replies usually start with a question, so I matched that pattern."
- **BANNED**: "I ran maya-voice-matcher on the gtmDraftedContent row and the voiceMatchScore was 0.62 so I rejected the draft."

## Output

POST scoring results to `/lc_gtm/update_draft_voice_match` (Sprint 2.4 endpoint):

```ts
{
  idempotencyKey: string,           // hash of (draftId + version)
  draftId: Id<"gtmDraftedContent">,
  voiceMatchScore: number,          // 0-1
  slopCriticPassed: boolean,
  slopCriticFailures?: string[],    // populated when not passed
  approvalStateUpdate?: "pending_approval" | "rejected",  // routing decision
  userFeedback?: string,            // when rejected
}
```

## Failure modes

- **No voice signal available** (no ingested posts, no public writing, no prior drafts, no onboarding answers beyond minimal). Voice score (Anchor A) defaults to neutral 0.5 — but **the venue style exemplars (Anchor B) still give you a register floor**, so don't ship voiceless: match the native cadence/length/format of the exemplars and lean on specificity. Surface to user via Telegram: "I need a sample of how you write so my drafts sound like you. Reply with 2-3 sentences in your usual voice."
- **All drafts failing both gates.** Likely the subagent is producing template-y output. Reset: re-spawn the subagent with a tighter prompt + explicit voice samples from USER.md.
- **Operator approval inconsistency** (approves draft A, rejects functionally-identical draft B). Surface the contradiction: "I noticed you approved [link] but rejected [link] which read very similarly. Want to tell me what's different about them?" Voice profile updates from the answer.

## Cost discipline

0 ScrapeCreators. Optional 1 Composio call (fetch public writing — cached after first pull). 1-2 main_maya LLM calls per draft (scoring is mostly structured-output work; voice analysis can use medium thinking budget). Timeout 3 min per draft.

## Anti-slop check

Yes — this skill itself outputs operator-facing copy (when surfacing voice feedback). All output passes the same slop-critic gate it enforces on drafts.
