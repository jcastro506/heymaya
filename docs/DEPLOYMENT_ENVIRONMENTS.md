# HeyMaya Deployment Environments

This repo uses Git branches for code promotion and separate Convex/Vercel
targets for runtime isolation.

## Branches

- `codex/*`: active feature work.
- `staging`: stable QA branch for live end-to-end tests.
- `main`: production branch.

## Convex

Local development stays on the personal dev deployment:

- Deployment: `dev:vibrant-platypus-264`
- URL: `https://vibrant-platypus-264.convex.cloud`

Creator Maya staging currently uses a long-lived dev deployment:

- Ref: `castrojoshua805:heymaya:dev/staging`
- Deployment: `precise-canary-781`
- URL: `https://precise-canary-781.convex.cloud`
- HTTP actions URL: `https://precise-canary-781.convex.site`

Deploy functions to staging:

```bash
CONVEX_DEPLOYMENT=dev:precise-canary-781 npx convex dev --once --tail-logs disable
```

Sync backend secrets to staging without changing `.env.local`:

```bash
./scripts/sync-env-to-convex.sh --deployment dev/staging
```

Convex also has a named production-style deployment ref `staging` provisioned.
Use it only after adding a staging deploy key in CI or moving staging to a
separate Convex project. Convex's documented permanent-staging path is a
separate project with `CONVEX_DEPLOY_KEY` set for that environment.

## Vercel

The local Vercel project link points at:

- Project: `hey-ava-web`
- Production URL: `https://www.hey-maya.ai`

The project is not currently connected to a Git repository in Vercel, so branch
scoped Preview environment variables are unavailable. Manual Preview deploys
use the Preview environment. Its public Convex variables have been pointed at
Creator Maya staging:

- `NEXT_PUBLIC_CONVEX_URL=https://precise-canary-781.convex.cloud`
- `NEXT_PUBLIC_CONVEX_SITE_URL=https://precise-canary-781.convex.site`

Deploy the current branch to a Vercel Preview:

```bash
npx vercel --target preview
```

Promote to production only from `main` after staging passes:

```bash
npx vercel --prod
```

## Promotion Flow

1. Build on `codex/*`.
2. Run local tests and `npx convex dev --once` against personal dev.
3. Merge or fast-forward into `staging`.
4. Deploy Convex staging.
5. Deploy Vercel Preview from `staging`.
6. Run live E2E: signup, onboarding, Google Calendar, iMessage pairing,
   OpenClaw deployment, daily brief, media ingest/edit request, account delete.
7. Merge `staging` to `main`.
8. Deploy Convex production and Vercel production.

## Production Guardrail

Do not run `npx convex deploy` from a feature branch. It deploys to the
default production deployment for the project unless `CONVEX_DEPLOY_KEY` is
configured for another target.
