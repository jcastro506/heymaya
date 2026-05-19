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
- GitHub repo: `jcastro506/heymaya`

The Vercel project is connected to GitHub. `vercel.json` limits automatic Git
deployments to the long-lived release branches:

- Pushes to `staging` create Preview deployments.
- Pushes to `main` create Production deployments.
- Pushes to `codex/*` and other scratch branches do not create Vercel builds.

The `staging` branch has branch-scoped Preview public Convex variables pointed
at Creator Maya staging:

- `NEXT_PUBLIC_CONVEX_URL=https://precise-canary-781.convex.cloud`
- `NEXT_PUBLIC_CONVEX_SITE_URL=https://precise-canary-781.convex.site`
- `NEXT_PUBLIC_CONVEX_HTTP_URL=https://precise-canary-781.convex.site`

`NEXT_PUBLIC_CONVEX_HTTP_URL` and `NEXT_PUBLIC_CONVEX_SITE_URL` intentionally
share the same `.convex.site` value. The iMessage Google Calendar OAuth
callback accepts either name, but Vercel Preview should carry both so older
deployments and docs stay aligned.

Manual Preview deploys still work when needed:

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
5. Push `staging`; Vercel creates a Preview deployment using staging Convex.
6. Run live E2E: signup, onboarding, Google Calendar, iMessage pairing,
   OpenClaw deployment, daily brief, media ingest/edit request, account delete.
7. Merge `staging` to `main`.
8. Deploy Convex production and push `main`; Vercel creates a Production
   deployment for `https://www.hey-maya.ai`.

## Production Guardrail

Do not run `npx convex deploy` from a feature branch. It deploys to the
default production deployment for the project unless `CONVEX_DEPLOY_KEY` is
configured for another target.
