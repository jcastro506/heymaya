# Maya solo deploy — contract for Sprint 2's onboarding flow

This dir owns the **deploy** step (step 8 of the Sprint 2 onboarding flow).
Sprint 1 ships the deploy plumbing; Sprint 2 wires the rest of the onboarding
pipeline (handles → scrape → synth → soul → deploy → first message) and calls
the action documented here.

## Public entry point

```ts
import { internal } from "convex/_generated/api";

const result = await ctx.runAction(internal.onboarding.maya.deployMaya.deployMaya, {
  creatorId,
});
```

`creatorId` is the only argument. Everything else (handles, connected accounts,
plan tier, channel preference, timezone) is read from Convex. The action does
**not** throw — it always returns a `DeployMayaResult` discriminated union:

```ts
type DeployMayaResult =
  | {
      ok: true;
      flyAppId: string;       // also written to creators.mayaFlyAppId
      machineId: string;      // Fly machine id
      configVersion: string;  // hex hash; logged for drift detection
      machineState: string;   // expected: "started"
      durationMs: number;
    }
  | {
      ok: false;
      stage:
        | "scrape-pull"
        | "synthesize-picture"
        | "generate-config"
        | "create-app"
        | "set-secrets"
        | "create-machine"
        | "wait-for-state"
        | "patch-creator";
      message: string;
      retryable: boolean;     // true => safe to invoke deployMaya again
      durationMs: number;
    };
```

The Sprint 2 onboarding screen renders the failure `stage` + `message` inline
and offers a "Retry" CTA when `retryable` is true.

## Side effects on success

- `creators.mayaFlyAppId` set to the Fly app name (`maya-{first-8-of-creator-id}`).
- `creators.mayaConfigVersion` incremented by 1 (it's a counter, not the hash —
  see schema note below).
- `creators.status` set to `"active"`.

## Side effects on failure

- `creators.status` reverted to `"onboarding"` so the UX can resume the flow.
  No new status enum is introduced (would require a schema change). The deploy
  log (Sprint 7) carries the stage/message diagnostics.

## Inputs we read from Convex

| Table              | Filter                  | Used for |
|--------------------|-------------------------|----------|
| `creators`         | `_id`                   | plan, timezone, channelPreference, email |
| `creatorHandles`   | `by_creator`            | one per platform Maya monitors |
| `connectedAccounts`| `by_creator`            | Composio bundles for Gmail / Stripe / Calendar / etc. |

Plan-tier gating is enforced server-side by `configGeneratorMaya.ts` via
`planFeatures(creator)`. Reading the channel set, skill set, and cron schedule
from the result is the only safe path; do not duplicate the gating logic in
callers.

## Required Convex env vars

`deployMaya` reads these from `process.env` (set via `npx convex env set ...`):

| Var                       | Purpose |
|---------------------------|---------|
| `FLY_API_TOKEN`           | Machines API auth |
| `FLY_ORG_SLUG`            | Org for app creation |
| `FLY_REGION`              | Default machine region (e.g. `iad`) |
| `MAYA_OPENCLAW_IMAGE`     | OpenClaw 2026.4.23 image ref. Optional; defaults to `registry.fly.io/heymaya-openclaw:v2026.4.23`. Operator must build + push this image to the Fly registry before deploys will work — see § Operator-blocked items in `MEMORY.md`. |
| `ENCRYPTION_KEY`          | base64 of 32 random bytes — decrypts Composio account ids |
| `SCRAPE_CREATORS_API_KEY` | shipped to each Maya as a Fly secret |
| `OPENROUTER_API_KEY`      | shipped to each Maya as a Fly secret |
| `COMPOSIO_API_KEY`        | shipped to each Maya as a Fly secret |
| `NEXT_PUBLIC_CONVEX_SITE_URL` (or `APP_URL`) | base URL Maya posts model-router calls to |

If any required Fly secret is missing in the Convex env, the deploy proceeds
but the resulting Maya will fail to start; the wait-for-state poll will time
out and the action will return `{ ok: false, stage: "wait-for-state", ... }`.

## Schema note — `mayaConfigVersion`

The current `creators` schema types `mayaConfigVersion` as `number`. The deploy
hash is a 32-char hex string. Rather than add a schema field, v0 stores the
**number of successful (re)deploys** in `mayaConfigVersion` and keeps the hash
as part of the deploy log (Sprint 7). A future sprint may migrate to a
dedicated `mayaConfigHash: string` field if drift detection becomes a
hot path.

## Bootstrap config shape — for the OpenClaw 2026.4.23 runtime

Each machine receives `MAYA_BOOTSTRAP_JSON` env var with the full config (see
`MayaConfig` type in `configGeneratorMaya.ts`):

```jsonc
{
  "schemaVersion": 1,
  "openclawVersion": "2026.4.23",
  "appName": "maya-abc12345",
  "creatorId": "...",
  "creatorEmail": "...",
  "plan": "pro",
  "timezone": "America/Los_Angeles",
  "channels": { "primary": "imessage", "fallbacks": ["whatsapp", "sms", "web"], "allowedAll": [...] },
  "soul": { "contentMd": "# Maya — soul...", "pathInWorkspace": "/data/soul.md", "isPlaceholder": true },
  "platformFiles": {
    "playbookPath": "/data/skills/maya-platform/playbook.md",
    "cronPath": "/data/skills/maya-platform/cron.md",
    "skillPath": "/data/skills/maya-platform/SKILL.md"
  },
  "skills": [ ... ],
  "composioAccounts": [ ... ],
  "handles": [ ... ],
  "thinkingBudget": { "maxAllowed": "high", "perTaskTag": { ... } },
  "cronEnablement": [ ... ],
  "modelRouter": { "convexHttpBase": "...", "callMayaActionPath": "agents/modelRouter/maya/callMaya" },
  "heartbeat": { "intervalSec": 300, "postPublishReactionLatencySec": 600 }
}
```

The OpenClaw runtime is expected to:
- write `soul.contentMd` to `soul.pathInWorkspace`;
- mount the shared playbook/cron/skill files (Sprint 3) at `platformFiles.*`;
- iterate `skills[]` and load each entry from a known disk location;
- start cron entries where `cronEnablement[i].enabled === true`;
- proxy model calls to `${modelRouter.convexHttpBase}/${modelRouter.callMayaActionPath}`.

**The lead must verify this contract against current OpenClaw 2026.4.23 docs.**
The shape was inferred from LaunchCrew's V3 multi-employee config (which we
could not read directly during the port — see deploy report). Mismatches
surface in the wait-for-state stage.

## Testing

Tests live in `convex/onboarding/maya/__tests__/deployMaya.test.ts`. The
deploy uses a module-scope `__setDeployMayaFlyClient(mock)` test seam that
lets us inject a stubbed FlyClient without going over the wire.

The five mandatory Sprint 1 test categories are covered:
1. Cross-tenant: deploying creator A never patches creator B's row.
2. Plan-tier: Starter creator's machine env contains web/sms only.
3. Adversarial: Fly returns 5xx on createMachine → failure surfaces as retryable.
4. Sibling-file scan: every cron entry id in config has a matching `cron.md`
   reference (cron.md ships in Sprint 3; the test compares against
   `ALL_CRON_ENTRIES` in `configGeneratorMaya.ts`).
5. TODO grep: no `TODO`/`FIXME`/`eslint-disable` in this file or its callees.
