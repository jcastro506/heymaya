---
name: maya-packet-generator
version: 0.1.0-sprint3.5
description: Manager-readiness packet generator. Assembles a creator's 90-day picture (snapshot, niche, audience, top posts, brand-deal log, voice samples, why-hire-me one-pager) and delegates final PDF render to Anthropic pdf skill. The packet is what a creator hands to a prospective human manager so the manager can evaluate them in 5 minutes.
when-to-use: Manager-readiness packet program — on-demand from chat (Studio) or quarterly cron (Pro+). Per readinessPacketCadence: Starter none, Pro quarterly, Studio on-demand. Do NOT invoke freeform — grounded entirely in Convex tables and runs through citation firewall before render.
plan-tier: pro+ for the cron cadence. Studio additionally permits on-demand. Starter has no readiness packet (readinessPacketCadence=none).
metadata:
  openclaw:
    requires:
      env: []
    tags:
      - packet
      - manager-readiness
      - pdf
      - reporting
      - creator
---

## Calls

- `maya-citation-firewall` — mandatory on every assembled section

## Delegates to

- `pdf` (Anthropic) — final byte-stream render
- `internal-comms` (Anthropic) — narrative section drafting


# maya-packet-generator

## What I'm building

A creator landed a discovery call with a real human manager. That manager will spend five minutes deciding whether the creator is worth a follow-up. Most creators leak that call because they re-tell their own story badly — they ramble through audience demographics, can't remember which brand deals signed, forget to surface their best posts.

The packet replaces that. One PDF the creator hands the manager before the call, every section grounded in citations from THEIR real data, neutral third-person prose because the reader is a stranger, not the creator. The creator owns the file; she decides who sees it.

I assemble + author. The actual `.pdf` byte-stream render is delegated to the Anthropic `pdf` skill.

## Why this skill stays neutral third-person (NOT voice-applied)

Every other prose surface Maya produces gets voiced through `maya-voice-applier`. This one doesn't, deliberately. The reader is a stranger evaluating the creator — neutral third-person reads as professional and assessable; voice-applied reads as the creator pitching herself, which is exactly the register a manager doesn't want from a packet. So this skill skips voice-applier on principle. The creator's voice shows up in the voice-samples section (three of her actual captions) — that's where the manager learns how she sounds.

## When I run

I am NOT a heartbeat skill. Two triggers, both gated by `readinessPacketCadence`:

- **Quarterly cron, Pro+.** Auto-refresh every 90 days so the creator always has a current version on hand. Fires via the standing order `manager_readiness_packet_quarterly`.
- **On-demand from chat, Manager only.** "Maya, build me a fresh packet, I have a call Friday." Assistant is gated out at the entry point — `requireFeature(creator, ..., "on-demand")` throws `PlanGateError`. Manager can request any cadence.

I never build a packet without a trigger. No heartbeat-tick authoring; this is too high-stakes a document to assemble speculatively.

## What the creator hears when the packet drops

When I'm done, the creator gets one short message in their voice with the URL — not a wall of section descriptions:

> "Your packet for Friday's call is ready."
> "[packet URL]"
> "Six pages. Niche, audience, top 5 posts, brand history, why-hire-me. Voice samples are your March bodega clip, the gym set, and the $2 ramen one — three that read most you."

The packet itself is the third-person artifact. The chat send announcing it is in the creator's voice — short, two or three sends, no internal IDs.

## Inputs

```ts
{
  creatorId: Id<"creators">;
  windowDays: number;       // typically 90; 30 / 90 / 180 supported
  triggeredBy: "on-demand" | "quarterly-cron";
  // Resolved-by-skill (the skill reads these from Convex):
  //   creatorPicture row (niche, audience, voice, top hooks, cadence, brand history)
  //   posts + postMetrics in the windowDays window
  //   brandDeals where status in ('signed','shooting','submitted','paid','closed')
  //   connectedAccounts (only Stripe + Calendar surface in the packet — Gmail does not)
}
```

## Outputs

```ts
{
  packetUrl: string;         // Convex storage URL — surfaced to the creator
  sections: PacketSection[]; // structured content used for the render (audit + diff)
  generatedAt: number;
  citationFirewall: { passed: true } | never; // throws if firewall fails
  windowDays: number;
}
```

## Sections (in order)

1. **Cover** — creator name, primary handle, packet date, window covered.
2. **Snapshot** — total followers across handles, posting cadence per platform, average engagement (saves + shares + comments) over window.
3. **Niche & Audience** — `creatorPicture.niche` + `creatorPicture.audience` (age ranges, geo top-3, interest tags). Narrative shaped by `internal-comms` skill. Stays neutral third-person — see the why-third-person rule above. Voice-applier deliberately skipped.
4. **Best-performing posts (top 5)** — one row per post: platform, hook pattern, view count, save count, comment count, why-it-worked annotation from `posts.mayaAnnotation`.
5. **Brand-deal history** — every signed-or-later deal in the window: brand, format, deliverables, dollar value (if known), payment status. Drawn from `brandDeals`.
6. **Voice samples** — 3 short post captions from the window that best match the `voiceFingerprint`. The manager learns the creator's voice in 60 seconds by reading these. (THIS is the section where the creator's voice lives — not in the surrounding prose.)
7. **Why-hire-me one-pager** — a single page synthesized from snapshot + audience + brand history + goals (`soul.md`). The pitch the creator would make to themselves if they were prepping for the call.

## How sections are assembled

Each section is built from a Convex read, then either:

- **Rendered as a structured table** (snapshot, top posts, brand-deal history) — no LLM in the loop, no hallucination surface. The numbers in the packet are the numbers in the database.
- **Drafted as prose by the `internal-comms` skill** (niche & audience, why-hire-me) — the prose is then passed to `maya-citation-firewall` with the source rows that justify every claim. If any claim fails, the section is rebuilt with the unsupported claim removed; if the rebuild still fails, the section ships as the structured-table version (degraded gracefully) rather than fictionalizing.

A packet with one fabricated brand deal destroys the creator's credibility on the call where it matters most. Better degraded than fictional. Always.

## Citation firewall — non-negotiable before render

The skill builds a `citationBundle` for every prose section: the section text + the row IDs (`posts._id`, `brandDeals._id`, etc.) that ground each claim. Bundle goes to `maya-citation-firewall`, which returns pass/fail + (on fail) the list of unsupported claims. The skill must remediate (rewrite or drop) before the PDF render is invoked. Bypassing the firewall is the worst thing you can do on this artifact.

## Plan-tier gating (server-side, fail-closed)

Plan gating is enforced by `planFeatures(creator)` at the entry point:

- `starter`: only the quarterly-cron caller is allowed. On-demand chat invocations throw `PlanGateError`.
- `pro`: quarterly-cron + on-demand allowed.
- `studio`: on-demand any cadence, quarterly auto.

The check uses `planFeatures(creator).readinessPacketCadence`:
- `none` → reject (defensive; current matrix never returns `none`, but the type allows it).
- `quarterly` → quarterly cron only; reject on-demand.
- `on-demand` → both allowed.

## Examples

See `examples/on-demand-pro.json` for an on-demand Pro packet input shape.
See `examples/quarterly-starter.json` for the quarterly cron variant.

## What this skill is NOT

- Not legal advice. The packet does not characterize whether the creator's brand-deal posture is "good" or "bad" — it surfaces what happened and lets the human manager reason about it.
- Not posted anywhere. Maya never publishes the packet on the creator's behalf. The packet URL is surfaced to the creator's primary channel; the creator decides who sees it.
- Not edited in this skill. The creator can request a regeneration with different `windowDays`, but in-place edits to a generated packet are out of scope for v0.

## Sprint 4 schema dependency

Packet URLs are stored in a `packetGenerations` table (creator-scoped, with `packetUrl`, `windowDays`, `generatedAt`, `triggeredBy`, `version`). The schema add lands in Sprint 4 alongside the other Maya tables; until then, the skill's `packetUrl` write goes through a stub mutation that returns the storage URL but skips the table insert.
