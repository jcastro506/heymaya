---
name: maya-contract-redflag
version: 0.1.0-sprint3.5
description: PDF brand-deal contract red-flag scanner. Delegates parse to Anthropic pdf skill, then runs a legal-pattern detector over extracted clause text. Surfaces severity-tagged flags (exclusivity, IP grants, payment terms, kill fees, FTC disclosure, morality clauses, unilateral term-extension, content-approval bottlenecks) + a sign/negotiate/walk recommendation. Flagging tool, not legal advice — Maya surfaces, creator brings to lawyer.
when-to-use: Event-driven on PDF contract upload to Deals or attached in chat (Contract red-flag scan program). Always invoke this skill, do not freelance the analysis — every flag must cite the parsed clause text.
plan-tier: ungated (Starter manual upload only since Starter has no inbound brand triage; Pro/Studio also fire from triage).
metadata:
  openclaw:
    requires:
      env: []
    tags:
      - contract
      - red-flag
      - pdf
      - brand-deal
      - legal
      - creator
---

## Calls

- `maya-citation-firewall` — mandatory; every flag must cite the parsed clause

## Delegates to

- `pdf` (Anthropic) — parse the contract PDF into structured text


# maya-contract-redflag

## What I actually do when a contract lands

It's 11pm. The creator just got a 14-page PDF from a brand and they want to sign it tonight because the shoot is Saturday. They scroll through, see boilerplate, and either sign blind or sit on it scared. Nobody in their corner can read the thing.

I'm the first read. I take the PDF, I scan every clause for the eight categories of pain creators get burned on — perpetual IP grants buried in "all media now known or hereafter devised," exclusivity windows that block the next deal, payment net-90, missing kill fees, missing FTC disclosure, morality clauses with no due process, unilateral term extension, content approval that grinds for 5+ rounds. I quote the verbatim clause for each flag, page numbers and all, then I tell the creator what to ask their lawyer about and (if they don't have one yet) what to push back on themselves.

The chat read sounds like:

> "Read the contract. Three flags worth talking about."
>
> "Page 4: 'in any media now known or hereafter devised' — that's a perpetual IP grant. Industry standard is 12 months. Negotiate."
>
> "Page 7: net-90 payment. Standard is net-30 to net-60. Push for net-30."
>
> "Page 11: no kill fee on a paid shoot. If the shoot gets canceled after you've prepped, you get nothing. Ask for 50%."
>
> "Want me to draft the negotiation reply?"

Three flags, three quotes, three concrete asks. Not a "comprehensive risk analysis." A real friend who knows what gets people burned.

## What I do NOT do

I **flag**. I do **not opine**. There is no "this contract is fine" verdict from me — only "no flag detected on category X." That distinction is load-bearing: a missed clause with a "fine" stamp is worse than no scan at all. Every output I send the creator includes the line *"this is a flag, not legal advice — get a lawyer if anything feels off."*

I'm the safety net before the lawyer call, not the lawyer.

## Workflow — under the hood

1. **Hand the PDF to Anthropic's `pdf` skill** for parse + clause segmentation. Get back structured text with page numbers and clause hashes.
2. **Run the regex/keyword rule set** (REDFLAG_RULES in script.ts) over each clause. Each rule is `{ regex, category, severity, concernTemplate, suggestionTemplate }`. Deterministic — same parsed text, same flags.
3. **Cross-reference creator's floorRate from soul.md** when scoring payment-term flags. Net-90 on a $5K deal is more flagable than net-90 on a $50K deal where it's industry standard.
4. **Synthesize the summary** (high thinking, model router) only after every individual flag is grounded in a verbatim clause cite that the firewall has verified.
5. **Compute the recommendation** — `walk` / `negotiate` / `sign`.
6. **Return** with the disclaimer baked in.

## Inputs

```ts
{
  contractPdfUrl: string;      // Convex storage URL
  creatorId: Id<"creators">;   // for cross-tenant scoping + audit
}
```

## Outputs

```ts
{
  redFlags: RedFlag[];
  recommendation: "sign" | "negotiate" | "walk";
  summary: string;             // ≤ 3 sentences for the chat ping
  counts: { high: number; medium: number; low: number };
  parsedPageCount: number;
  citationFirewall: { passed: true } | never;
}

interface RedFlag {
  severity: "high" | "medium" | "low";
  category: RedFlagCategory;
  clause: string;              // verbatim clause text from the parsed PDF
  page: number;
  concern: string;             // plain-language description of the risk
  suggestion: string;          // negotiation language Maya recommends
  citation: { pageNumber: number; clauseHash: string };
}
```

## What I'm scanning for

| Category | What triggers it | Severity |
|---|---|---|
| `exclusivity-duration` | Exclusivity window > 30 days against the brand's category | high (>90d), medium (31–90d), low (<31d if unusual scope) |
| `ip-grant-perpetual` | Perpetual / works-for-hire / "in any media now known or hereafter devised" | high |
| `ip-grant-broad` | Multi-channel sublicensable rights without time limit | medium |
| `payment-net-days` | Net > 60 days to pay | high (>90), medium (61–90) |
| `missing-kill-fee` | No kill fee specified in a paid-shoot deal | medium |
| `ftc-disclosure-absent` | Contract does not require `#ad` / `#sponsored` disclosure language | high (regulatory exposure) |
| `morality-clause-overreach` | Termination on broadly-worded "conduct that brings disrepute" without due process | medium |
| `unilateral-term-extension` | Brand can extend the term without creator consent | high |
| `content-approval-bottleneck` | Brand approval required >2 rounds, >5 business days each | medium |

The keyword/regex patterns live in `script.ts`. Deterministic — same parsed PDF text, same flags. The LLM layer (high thinking) is invoked only for the `summary` synthesis at the end, and only after every flag is grounded.

## Recommendation logic

- `walk`: ≥ 1 high-severity flag in the IP / unilateral-term / payment-net categories.
- `negotiate`: ≥ 1 high or ≥ 2 medium flags.
- `sign`: zero high flags, ≤ 1 medium flag.

## Citation firewall

Every flag must cite the verbatim clause text and a page number that resolve back to the parsed PDF. The firewall is invoked once per flag with the clause as the single citation; on failure the flag is dropped (not weakened — dropped). The summary text is firewalled against the bundle of all surviving flags.

## NOT legal advice — explicit disclaimer

This skill flags risks. It does not interpret enforceability, jurisdiction, or remedy. Every Maya output that surfaces a flag must include the line "this is a flag, not legal advice — get a lawyer if anything feels off," per `playbook.md § Contract red-flag scan`. The skill enforces this by emitting the disclaimer as part of the `summary` string.

## Plan-tier gating

All tiers (Assistant + Manager). Contract liability protection is a baseline feature — every creator who uploads a contract gets it scanned.

Note: on Assistant, contract uploads happen manually (Deals screen drag / chat attachment). On Manager, the brand-deal-triager auto-fires this skill in parallel when a contract PDF is attached to an inbound email.

## Examples

See `examples/exclusivity-grant-redflag.json` for a contract with exclusivity + IP issues. See `examples/clean-contract.json` for a passing contract.
