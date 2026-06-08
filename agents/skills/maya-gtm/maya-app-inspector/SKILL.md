---
name: maya-app-inspector
description: Inspect a product URL + walkthrough and emit a structured ProductDiagnosis (promise, target action, activation moment, showable demo beats).
---

# maya-app-inspector

## Purpose

Before any channel decision, ICP hypothesis, or draft, Maya needs to know what the product actually does — in the operator's terms, not marketing copy. This skill converts a URL (and optional walkthrough video / screenshots) into a `ProductDiagnosis` other skills consume. Without a clean diagnosis, every downstream subagent guesses.

## When to invoke

- IF a new GTM job starts AND `productDiagnosis` is null in MEMORY THEN run this first.
- IF the operator says "actually it does X" and APP.md disagrees THEN re-run to update the diagnosis.
- IF the app URL changes (new landing, repositioning) THEN re-run.
- IF a downstream skill (channel-judge, slop-critic, viral-demo-miner) reports `failure_reason: "diagnosis_too_thin"` THEN re-run with deeper walkthrough request.
- NEVER invoke from heartbeat. App inspection is a research-job action; it spends budget.

## Required inputs

- `app.url` — public landing or product URL.
- `app.name` — verbatim string the operator uses.
- `app.stage` — `pre-launch | soft-launched | shipped | post-FMF`.
- Optional: `walkthroughVideoUrl` (R2/Drive), 1-5 `screenshotUrls`, free-text founder description.
- `operatorIntent` — one-line statement the operator already gave (verbatim, do not normalize).

## Required reads

1. `APP.md` in the workspace (current snapshot — your diagnosis may overwrite it).
2. `PLAYBOOK.md` § 1.2 (positioning sentence: "buyer + outcome in one sentence with a named verb").
3. `PLAYBOOK.md` § 5 Failure Mode 4 (the "feature launch" — describing the product as features instead of an outcome).
4. `MEMORY.md` for prior diagnoses if this is a re-run.

## Decision rules

1. **Rule 9.2 enforcement.** IF you cannot produce `oneSentencePromise = "<product> helps <named buyer> <named verb-outcome>"` from the evidence THEN return `status: "needs_walkthrough"` and a 3-question intake. Do not fabricate a buyer. PLAYBOOK rule 9.2.
2. **Rule 9.1 grounding.** IF the operator's stated intent is "I want to go viral" / "make me famous" THEN ignore that input for the diagnosis (it is not a product fact) and note it in `operatorAmbiguities`. Rule 9.1.
3. **Showability gate.** IF you cannot identify a `showableDemoBeat` (a UI moment ≤10s, a before/after, or a tangible output) THEN mark `showability: "unshowable"`. This is decision-grade input for `maya-tiktok-demo-strategist`.
4. **Feature-vs-outcome scan.** IF the product description leads with feature names ("webhook router", "AI agent platform") instead of a user outcome THEN populate `featureLanguageRisk: true`. Failure Mode 4. Pass this to slop-critic so it knows to rewrite operator drafts that mirror it.
5. **Activation moment required.** Every diagnosis must name the **single user action that produces the "aha" moment** (Cal AI: point camera at food). IF you cannot name it THEN return `status: "needs_walkthrough"`.
6. **Audience-not-buyer trap.** "Devs", "creators", "builders" are NOT buyers — they are audiences. The buyer is the specific person with the specific pain. IF the diagnosis only names an audience THEN flag `buyerSpecificityWeak: true` so `maya-icp-hypothesis` runs deeper.
7. **Stage-gates downstream.** IF `app.stage === "pre-launch"` AND the landing page is a waitlist with no live product THEN add `redditSubReco: "r/AlphaAndBetaUsers"` (reddit.md rule 9 — r/SideProject requires live URL).
8. **No invented numbers.** Never write metrics into the diagnosis (signups, MRR, DAU) unless they appear verbatim on the landing page or operator transcript. Rule 9.10 / citation-firewall.
9. **One sentence per field.** Verbose diagnoses signal that you didn't understand the product. Target: every field ≤ 25 words. If you can't, the product is unclear and the diagnosis is `status: "needs_walkthrough"`.
10. **No anti-slop wrapping yet.** This skill emits structured data, not draft prose, so the slop-critic is not invoked. The diagnosis is read by humans + skills only.

## Output schema

```ts
interface ProductDiagnosis {
  status: "ok" | "needs_walkthrough" | "blocked";
  oneSentencePromise: string;          // "<product> helps <buyer> <verb-outcome>"
  targetAction: string;                 // the single user action that triggers value
  activationMoment: string;             // the "aha" — what the user sees / feels
  showability: "screen-recordable" | "screenshot-only" | "unshowable";
  showableDemoBeats: string[];          // 1-5 specific moments ≤10s each
  buyerHypotheses: string[];            // 2-4 candidate buyers (raw; icp-hypothesis sharpens)
  buyerSpecificityWeak: boolean;
  featureLanguageRisk: boolean;
  competitorMentions: string[];         // names found on landing or in walkthrough
  pricingSignals: string | null;        // verbatim or null
  unansweredQuestions: string[];        // ask-the-operator queue
  evidence: Array<{ source: "landing" | "walkthrough" | "operator"; url?: string; excerpt: string }>;
  redditSubReco?: string;               // optional fast-route hint
  operatorAmbiguities: string[];
}
```

## Failure modes

- **`needs_walkthrough`** — landing page is too thin (≤3 sentences of body copy, no demo, no screenshots). Return a 3-question intake: (a) what's the single thing a user does that makes them say "oh"; (b) what would you show a friend in 30 seconds; (c) name one user (or imagined user) and what they were doing before they found you.
- **`blocked` — URL unreachable.** Don't guess from the name. Return the HTTP status and stop.
- **Operator-supplied marketing copy.** Treat their landing page as a primary source but their *pitch deck phrasing* as suspect. Strip "game-changing" / "supercharge" / "unlock" before quoting in `evidence.excerpt`.

## Cost discipline

- 0 ScrapeCreators calls. App inspection is operator-data + landing-page fetch only.
- 1 WebFetch on the landing URL. 1 more allowed for `/about` or `/pricing` IF the diagnosis needs it.
- 1 model call (main_maya, default thinking) to synthesize. Re-run only on `needs_walkthrough`.
- Hard cap: 12 minutes wall-clock. If you spend longer, the diagnosis is structurally unclear — stop and return `needs_walkthrough`.

## Anti-slop check

This skill produces structured data, not draft prose. Slop-critic is NOT invoked on the diagnosis output. However: when populating `oneSentencePromise`, do a single-pass slop scan against the PLAYBOOK.md § 6 banned-phrase list. If you find yourself writing "supercharge", "unlock", "empower", "leverage" — rewrite using the operator's own vocabulary. The diagnosis is the seed for every downstream draft; if it's slop here, it propagates.
