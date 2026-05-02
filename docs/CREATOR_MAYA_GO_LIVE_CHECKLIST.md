# HeyMaya Beta Execution Tracker

This is the working punch-list for getting HeyMaya to a real beta: landing page,
creator onboarding, business onboarding, Clerk, Google Calendar, Vercel,
OpenClaw/iMessage, skills, and test gates.

Status key:

- `[x]` done and locally verified
- `[~]` in progress / partially done
- `[ ]` not done
- `[!]` blocked by account approval, external review, or explicit operator
  confirmation

## Product Positioning

- [x] Set top-level brand: **HeyMaya is an AI manager in your messages**.
- [x] Keep creator wedge sharp: **a manager before human managers care**.
- [x] Keep business entry clear: **a marketing manager before you hire one**.
- [x] Add top navigation for both paths: `For creators` and `For businesses`.
- [x] Add landing-page track chooser with distinct creator/business promises.
- [ ] Decide whether `/business` remains trades-specific or becomes broader
  "business Maya" for creator-led/local businesses.
- [ ] Add pricing/plan copy that matches the two-track story without making
  visitors choose between unrelated products too early.

## Current Environments

- [x] Local app: `http://localhost:3020`.
- [x] Local Clerk development instance wired.
- [x] Local Convex dev deployment wired.
- [x] Google Calendar test OAuth client created for local/staging testing.
- [x] Vercel project linked to this repo.
- [x] Staging/preview deployment live:
  `https://hey-ava-web-jcastro506-jcastro506s-projects.vercel.app`.
- [ ] Production deployment live at `https://www.hey-maya.ai`.

## Creator Onboarding

- [x] `/creator-maya-v0` exists as focused creator setup.
- [x] Account creation/sign-in redirects back to creator onboarding.
- [x] Creator picture intake captures goal, blocker, niche, weekly hours.
- [x] TikTok handle connection path exists through ScrapeCreators action.
- [x] Google Calendar web OAuth start/callback routes exist.
- [x] Apple phone calendar mode exists as the phone-native placeholder.
- [x] Phone number capture exists for OpenClaw native iMessage handoff.
- [x] Calendar disconnect removes stored connection and lookahead events.
- [x] Debug console remains available at `/creator-maya-v0/debug`.
- [ ] Add final "You're all set. Maya will text you directly." handoff screen
  after required data is captured.
- [ ] Track setup state separately from runtime state:
  - `setup_complete`: web onboarding data is saved
  - `maya_provisioning`: OpenClaw/Fly workspace is being created
  - `maya_online`: OpenClaw is healthy and the iMessage channel is ready
  - `first_text_sent`: Maya has sent the activation iMessage
- [ ] Make creator onboarding copy explicitly explain:
  - Maya is your pre-human-manager manager
  - web setup is temporary
  - the real product is iMessage
  - calendar is used for content planning, not surveillance
- [ ] Add signed-in status page copy for provisioning delays and failures.

## Business Onboarding

Existing route: `/onboarding/business`.

- [x] Existing service-business onboarding route exists.
- [x] Existing service-business flow captures GBP, optional social, optional
  CRM, service questions, channel, deploy.
- [~] Flow is currently trades/home-service specific.
- [x] Create a slightly different **business Maya beta onboarding** for the new
  landing-page promise:
  - business type / category
  - product or service sold
  - target customer
  - service area or market
  - top marketing goal
  - current channels
  - calendar availability
  - preferred message channel
  - review/post/lead-response permissions
- [x] Use a new route: `/business-maya-v0`, leaving the existing trades-specific
  `/onboarding/business` intact.
- [x] Broad Business Maya v0 intake is durable in Convex via
  `businessMayaV0Intake`.
- [ ] Keep Google Business Profile optional for non-local/creator-led businesses.
- [ ] Business onboarding should still end in the same phone-first Maya runtime.
- [x] Add render test for the broad business onboarding branch.
- [x] Add Convex persistence tests for broad Business Maya v0 intake.

## Calendar And Scheduling

- [x] Starter includes calendar-aware planning.
- [x] Direct Google Calendar OAuth routes exist:
  - `/api/google-calendar/start`
  - `/api/google-calendar/callback`
- [x] Google Calendar lookahead import exists.
- [x] Calendar event privacy redaction exists.
- [x] Calendar disconnect exists.
- [x] Maya-owned hold scheduling is tested in Convex mock flow.
- [ ] Live Google Calendar OAuth needs another browser pass after production
  envs are in place.
- [ ] Calendar write policy needs production copy: Maya only creates/updates
  Maya-owned holds after user approval.
- [x] Browser onboarding uses Google OAuth as the real calendar connection path.
  Mobile browsers can show OS-aware copy, but cannot reliably detect whether
  Google Calendar or Apple Calendar apps are installed. Use app/deep links only
  as optional affordances with browser OAuth or iPhone handoff fallback.

## OpenClaw And iMessage

- [x] Product direction is iMessage-only for the first creator beta.
- [x] Phone capture exists in onboarding.
- [x] OpenClaw workspace manifest exists for Creator Maya.
- [x] Native iMessage pairing gate is represented in backend tests.
- [ ] Onboarding completion should enqueue OpenClaw provisioning and show the
  handoff screen immediately, without requiring the user to wait on the page.
- [ ] When OpenClaw is online, Maya sends the first iMessage to the captured
  phone number and records `first_text_sent`.
- [ ] If OpenClaw provisioning fails, show a web status error and alert the
  operator instead of leaving the user in a silent pending state.
- [x] Live OpenClaw deployment from signed-in localhost onboarding reached Fly
  machine started + OpenClaw gateway ready with bundled Creator Maya skills.
- [ ] Native iMessage pairing still needs a real end-to-end phone test.
- [ ] Daily iMessage schedule needs production cron/heartbeat verification.
- [x] iMessage account deletion confirmation path exists:
  - `POST /api/account/delete/request-from-imessage`
  - `POST /api/account/delete/from-imessage`
  - exact confirmation phrase: `DELETE MAYA`
- [ ] Define first-message timing after onboarding:
  - immediate activation text only after OpenClaw is online and iMessage can send
  - first morning brief next local morning
  - evening recap only after there is activity or a missed plan

## Skills And Media Editing

Deployment rule:

- [x] Creator custom skills are bundled into every Creator Maya OpenClaw
  workspace manifest under `skills/<slug>/SKILL.md`.
- [x] Creator workspace tests assert the same skill pack is emitted for every
  workspace.
- [x] Creator workspace now includes media composition and account-deletion
  confirmation skills in the bundled pack.
- [ ] External mechanics skills, if any, must be pinned and resolved during
  deploy/first boot before Maya is marked active. Maya must not discover,
  install, or upgrade skills during a user conversation.
- [ ] Add a deploy gate that fails if a required external skill cannot be
  resolved before activation.
- [ ] Add a version lock file for approved external skills so deployments are
  repeatable.

Service/business track:

- [x] Existing `maya-service-clip-composer` skill exists.
- [x] Current decision: Maya owns composition judgment; ClawHub/cloud composer
  owns rendering mechanics.
- [x] Existing spike rejects vendored low-level FFmpeg as the default path.
- [x] Candidate renderer family is NemoVideo / CapCut-style ClawHub composer.

Creator track:

- [x] Add a creator-specific `creator-clip-composer` workspace skill.
- [ ] Decide highest-level renderer first:
  - preferred: ClawHub/cloud video composer if reliable
  - fallback: Claude Code / Remotion / FFmpeg skill for local deterministic edits
  - avoid: Maya authoring bespoke FFmpeg pipelines in product code
- [ ] Define creator use cases:
  - clip hook test
  - cut down long video into TikTok draft
  - caption/burn-in variant
  - B-roll ordering
  - repost-ready short from calendar/event footage
- [ ] Gate media editing by tier and approval:
  - Starter: edit suggestions, not rendered edits
  - Pro/Studio: rendered drafts if renderer is connected
  - never auto-post
- [x] Add install/deploy check: every Maya workspace gets the same approved
  video composer skill, not per-user drift.
- [ ] Add tests for missing renderer, poor source footage, prompt injection in
  clip notes, and output duration/aspect constraints.
- [ ] Plan and build `creator-seedance-video-generator` as a deferred
  OpenClaw runtime skill:
  - channel: creator texts Maya one or more approved self/reference images over
    iMessage
  - storage: persist originals and generated videos in creator-owned R2 objects
  - model: OpenRouter `bytedance/seedance-2.0`
  - default output: 9:16, 720p, 5 seconds; allow 1080p or longer only after
    explicit approval
  - inputs: creator-owned image references, prompt, optional first/last frame,
    creator context, and posting goal
  - approval gate: Maya quotes estimated cost before a paid generation job
  - output: Maya texts the generated video back with caption, hook, and posting
    plan
  - safety: never use another person's image unless the creator explicitly
    sends or approves it
  - test gates: mocked OpenRouter job lifecycle, R2 ownership checks,
    cross-tenant isolation, approval-required cost guard, 9:16 constraint, and
    failed-job recovery path

## ScrapeCreators And Trend Scan

- [x] ScrapeCreators is the first read layer.
- [x] Smart sampling avoids asking Gemini to watch 30 full posts.
- [ ] Evaluate ScrapeCreators agentic mode for trend scan and creator context.
- [ ] Keep Apify as fallback only if ScrapeCreators cannot provide a needed
  trend/source capability reliably.
- [ ] Add live API smoke once ScrapeCreators keys are in Vercel/Convex.

## Clerk Production

- [x] Dedicated HeyMaya Clerk development app exists.
- [x] Local Clerk env is wired.
- [x] Clerk `convex` JWT template exists in development.
- [x] Convex dev `CLERK_JWT_ISSUER_DOMAIN` is set.
- [ ] Activate/configure HeyMaya production Clerk instance.
- [ ] Attach production auth domain.
- [ ] Configure production Google sign-in credentials for Clerk auth.
- [ ] Create production `convex` JWT template.
- [ ] Set production Clerk env vars in Vercel:
  - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
  - `CLERK_SECRET_KEY`
  - `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`
  - `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up`
  - `CLERK_JWT_ISSUER_DOMAIN`
- [ ] Set matching `CLERK_JWT_ISSUER_DOMAIN` in Convex production.
- [ ] Verify production sign-up, sign-in, onboarding, and Convex auth.

## Account Deletion

- [x] Browser delete-account route exists at `/account/delete`.
- [x] Protected delete API exists at `POST /api/account/delete`.
- [x] Delete API purges Convex account data and then deletes the Clerk user.
- [x] iMessage delete request API exists for Maya/OpenClaw.
- [x] iMessage delete confirmation API requires exact `DELETE MAYA`.
- [x] Convex deletion tests cover:
  - bad shared secret fails closed
  - creator-scoped rows are removed
  - business-scoped rows are removed
  - growth-agent rows are removed
  - Stripe customer audit rows are removed
  - iMessage confirmation mismatch does not delete
- [ ] Live browser deletion test on a disposable Clerk account.
- [ ] Live iMessage deletion test on a disposable paired account.

## Google Calendar Production

- [x] Google Cloud project exists: `Creator Maya`.
- [x] Google Calendar API is enabled.
- [x] OAuth client exists for local and production redirect URIs.
- [x] OAuth test user includes `castrojoshua805@gmail.com`.
- [x] Public `/privacy` and `/terms` pages exist.
- [ ] Add/confirm staging redirect URI:
  - `https://hey-ava-web-jcastro506-jcastro506s-projects.vercel.app/api/google-calendar/callback`
- [ ] Verify ownership of `hey-maya.ai` in Google.
- [ ] Add/confirm OAuth app URLs:
  - Homepage: `https://www.hey-maya.ai/`
  - Privacy: `https://www.hey-maya.ai/privacy`
  - Terms: `https://www.hey-maya.ai/terms`
- [ ] Confirm production redirect URIs:
  - `https://www.hey-maya.ai/api/google-calendar/callback`
  - `https://hey-maya.ai/api/google-calendar/callback`
- [ ] Submit OAuth verification with a demo video showing account creation,
  Calendar consent, Calendar disconnect, and scope justification.
- [!] Open access to all Google users requires app production/verification.
  Until then, live beta users must be Google OAuth test users.

## Vercel Domain And Deployment

Current discovery:

- [x] CLI identity: `jcastro506`.
- [x] Scope with the domain: `jcastro506s-projects`.
- [x] Existing project: `hey-ava-web`.
- [x] Project ID: `prj_9MIAgVnqio6Ya6NuazO8nvmozxs6`.
- [x] Production aliases:
  - `https://www.hey-maya.ai`
  - `https://hey-maya.ai`
- [x] DNS points to Vercel.
- [x] This repo is linked locally through `.vercel/project.json`.
- [x] Project framework settings updated on May 2, 2026:
  - framework: `nextjs`
  - build command: `npm run build`
  - output directory: unset / framework default
  - Node: `24.x`
- [x] Preview env vars are set in Vercel.
- [x] Production env vars are set in Vercel; do not production-deploy until
  final go-live approval.
- [x] Convex production env vars are set and Convex production was deployed.
- [x] Vercel Authentication protection was disabled for this project so preview
  links are testable without Vercel login.
- [x] Deploy preview from this branch.
- [x] Verify preview routes:
  - `/`
  - `/creator-maya-v0`
  - `/business-maya-v0`
  - `/privacy`
  - `/terms`
  - `/account/delete`
  - `/api/google-calendar/start`
  - `/api/account/delete/from-imessage`
  - `/api/account/delete/request-from-imessage`
- [!] Production deploy replaces current `hey-ava-web` landing page on
  `hey-maya.ai`; confirm before running.

## Test Gates

Latest local gate results:

- [x] `npm run build` passed on May 2, 2026.
- [x] `npm test` passed on May 2, 2026: 169 files, 2596 tests.
- [x] `npm run smoke:creator-maya-v0` passed on May 2, 2026.
- [x] `npx convex dev --once` passed on May 2, 2026.
- [x] Focused ESLint on touched files passed on May 2, 2026.
- [x] `npm test -- convex/onboarding/business/__tests__/businessMayaV0Intake.test.ts components/businessMayaV0/__tests__/Onboarding.test.tsx convex/__tests__/accountDeletion.test.ts` passed on May 2, 2026.
- [x] `npm test -- convex/creatorMayaV0/__tests__/workspaceManifest.test.ts convex/onboarding/business/__tests__/businessMayaV0Intake.test.ts convex/__tests__/accountDeletion.test.ts` passed on May 2, 2026.
- [x] `npm run build` passed after account deletion, Business Maya durable
  intake, and skill-pack updates on May 2, 2026.
- [x] `npx convex dev --once` passed after schema/function updates on May 2,
  2026.
- [x] Focused ESLint passed after account deletion, Business Maya durable
  intake, and skill-pack updates on May 2, 2026.
- [!] Full `npm run lint` hung silently; use focused lint until repo-wide lint
  is debugged.
- [x] Browser local pass checked `/creator-maya-v0` and `/privacy`.
- [x] Browser local pass checked `/business-maya-v0` after broad business
  onboarding was added.
- [x] Browser local pass checked `/account/delete` in signed-in Chrome; delete
  button stays disabled until exact phrase is entered.
- [x] Focused `npx eslint app/account/delete/page.tsx middleware.ts` passed on
  May 2, 2026.
- [x] `npm test -- convex/__tests__/accountDeletion.test.ts` passed on May 2,
  2026.
- [x] `npm run build` passed after signed-out delete-account page fix on May 2,
  2026.
- [x] Preview deployment test passed on May 2, 2026 against
  `https://hey-ava-web-jcastro506-jcastro506s-projects.vercel.app`:
  - public pages return `200`
  - Google Calendar start returns auth redirect
  - Google Calendar callback errors redirect back to setup instead of rendering
    the callback URL
  - iMessage delete endpoints return `401` without shared secret
- [ ] Production smoke needs run only after explicit production deployment.

## Production Behavior Contract

- [x] The site creates the account and gathers setup context.
- [x] Maya lives in the user's iMessage thread after phone pairing.
- [x] Starter includes creator picture, TikTok context, Calendar-aware planning,
  and approved content holds.
- [x] Brand outreach remains approval-gated and does not send autonomous
  outbound email in Starter.
- [x] Calendar data is used only for creator planning and Maya-owned scheduling.
- [x] Business users get a distinct intake but share the same Maya runtime shape.
- [x] Media editing is approval-gated and never auto-posts in the workspace
  skill contract.
