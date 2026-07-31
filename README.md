# HeyMaya

> **A social media manager you employ.** She runs your accounts. You text her.

Maya watches your niche, makes the content, posts it, and answers everyone who replies — in your voice — across **TikTok, Instagram, YouTube, and X.** You manage her from Telegram.

**The pitch is not "she posts for you."** Open-source schedulers do that for free. It's that **she does the homework**: she watches what's actually working in your niche, mines what your buyers are complaining about, and *then* writes.

## Who it's for

A solo founder who built something good and can't get customers.

## How it works

| | |
|---|---|
| **She watches** | Six daily sweeps across the four channels — tracked competitors, topic search, rising sounds, and the comment sections your buyers are already writing in |
| **She learns your voice** | From your existing posts, from how you text her, and from every edit you make to her drafts |
| **She makes and posts** | Photo sets and carousels from your real screenshots; video when it earns its cost; adapted per channel, never carbon-copied |
| **She answers everyone** | Every comment, mention, and DM — *TikTok excepted, because its API exposes no comments to anyone* |
| **She proves it** | Placements → clicks → signups, benchmarked against the niche median — and she names which rung of the funnel is broken, **including when it isn't a social problem** |

## Documentation

| | |
|---|---|
| **`docs/CLEAN_SHEET_SPEC.md`** | **The product and technical spec.** Sprint plan is §18. Start here. |
| `docs/DEPLOYMENT_ENVIRONMENTS.md` | Branches, Convex deployments, Vercel |
| `CLAUDE.md` | Working conventions for this repo |
| `docs/AGENT_REDESIGN_V2.md` | The previous design (intent-hunting). Superseded — history only. |

## Stack

Next.js 16 App Router · TypeScript · Tailwind · shadcn/ui · Convex · Clerk · Stripe · OpenClaw on Fly.io · Telegram

- **Publish + own-account reads:** Zernio
- **Outside-world reads:** ScrapeCreators, plus twitterapi.io for X — the perception layer, and the moat
- **Creative:** direct model calls for daily static; Creatify for weekly assembled video
- **Storage:** Cloudflare R2

## Status

**Sprint 0a complete.** Two earlier products — Creator Maya and Maya for service businesses — were removed (~380 files, ~126k lines). Test baseline greened, CI added, orphan scripts and a legacy second dashboard cleared. 0 typecheck errors, all tests passing.

**Next:** Sprint 0b prunes the 71 orphaned Convex tables those products left behind.

**Sprint 3 is the gamble** — one channel, a placement a day, seven days straight, verified. Nothing past it is worth building until it holds.

## Development

```bash
npm install
npm run dev            # Next.js
npm run convex:dev     # Convex functions (local dev deployment)
npm test               # vitest
npx tsc --noEmit       # typecheck
```

Pushes to `staging` and `main` deploy; `codex/*` branches don't. CI runs typecheck and tests on the two release branches.

> **Gotcha:** a stale `.next` cache produces phantom `tsc` errors after deleting routes. `rm -rf .next`.
