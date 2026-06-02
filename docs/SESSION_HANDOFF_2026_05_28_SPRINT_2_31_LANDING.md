# Sprint 2.31 — Landing page handoff (2026-05-28)

## 🚨 Blocker the next session must clear first

`app/clawlaunch/page.tsx` is rejecting all writes (`Operation not permitted`). The `@` symbol in its mode bits indicates a macOS extended attribute / sandbox flag. Run ONE of:

```bash
chmod u+w /Users/joshcastro/Desktop/heymaya/app/clawlaunch/page.tsx
# or
sudo xattr -c /Users/joshcastro/Desktop/heymaya/app/clawlaunch/page.tsx
```

Or right-click in Finder → Get Info → uncheck **Locked**.

## State of the work

Branch: `staging`. All other Sprint 2.x work this session (2.28 / 2.29 / 2.30 / 2.26b / 2.27b / 2.21+2.24) is already committed. Only the landing page is uncommitted.

### What's done

- Hero locked: *"You built your dream app. / The internet didn't notice."* + *"We're the marketing team for your app. We find your audience on Reddit, TikTok, LinkedIn, Instagram, and X — write the content and ship it. You don't post a thing."*
- Pain section reworked into two-beat scroll reveal (*"You built it. That was the easy part."* → empty scroll → *"The hard part is getting users."*).
- All editorial chrome killed (no `§`, no figure captions, no version stamps, no eyebrow numerals).
- Green/lime accent dots all removed except scroll-line dot, which is now black.
- Animations slowed sitewide (transitions 1s → 1.8s, hero 1.4s → 2s, IntersectionObserver threshold 0.15 → 0.25).
- Channels section built — five platform panes (Reddit, TikTok, LinkedIn, Instagram, X) each with:
  - Left: logo + massive italic platform name + italic tagline + plain-English body
  - Right: small italic label + native-styled mockup
- Mockups built for all five:
  - **Reddit:** native thread mockup + drafted reply with orange accent line
  - **TikTok:** Brief card (hook + 5-beat script + caption + filming notes "no face needed")
  - **LinkedIn:** native founder post (avatar, name, "Founder · building [your app]" subtitle, story-arc body, reactions footer)
  - **Instagram:** Brief card (angle + 6-slide carousel breakdown + caption + visual notes)
  - **X:** native tweet draft (avatar, @yourname, body, engagement counters)
- `react-icons` ^5.6.0 installed but not yet wired in. Hand-drawn SVG logos still active.

### What's next (in order)

1. **Swap hand-drawn logos for Simple Icons.** Import from `react-icons/si`:
   - Reddit → `<SiReddit size={44} color="#FF4500" />`
   - TikTok → three-layer offset effect: cyan `#25F4EE` translated `-3px,+3px` + magenta `#FE2C55` translated `+3px,-3px` + black `#0a0a0a` on top
   - LinkedIn → `<SiLinkedin size={44} color="#0A66C2" />`
   - Instagram → wrap in gradient div (`linear-gradient(135deg, #FED373 0%, #F15245 28%, #D92E7F 60%, #9B36B7 100%)`, rounded ~22% of size), white `<SiInstagram>` inside
   - X → `<SiX size={44} color="#0a0a0a" />`
   - Also swap the Reddit logo used inline in the thread mockup header.
   - Delete unused hand-drawn `*Logo` functions.

2. **Tighten Reddit pane spacing** (applies to all 5 panes since `ChannelPane` is shared):
   - `mb-7` (logo → name) → `mb-5`
   - `mt-7` (name → tagline) → `mt-3`
   - `mt-7` (tagline → body) → `mt-5`

3. **Verify and ship:**
   - `npx tsc --noEmit` (ignore pre-existing `scripts/gtm-sprint-13-smoke.ts` errors)
   - `npx vitest run` — should stay 389/389
   - `npm run dev` — visual smoke test at `localhost:3000`
   - Commit on `staging` summarizing Sprint 2.31 in full
   - `git push origin staging`

## Locked decisions (don't relitigate)

- **ICP locked to vibe coders.** Non-technical builders who shipped on Replit/Lovable/Bolt/Cursor/v0/Claude. 9-to-5 jobs. No marketing instinct.
- **"Maya" name dropped from the landing.** Product = ClawLaunch on marketing surface; Maya persona only surfaces inside the product (Telegram).
- **Voice: direct, cheeky, non-technical, never preachy.** No MBA-speak ("bring to market"), no insider dev terms ("repo"), no editorial chrome.
- **NO UGC creation claim for TikTok / Instagram.** We deliver Briefs, not finished videos/carousels. The cheeky beat: *"no face needed."*
- **"We post for you" is the locked brand promise**, backed by Composio where supported and manual one-tap approval elsewhere.

## Files touched this session (uncommitted)

```
M app/clawlaunch/page.tsx       — full landing rewrite
M app/page.tsx                  — metadata moved to server boundary
M package.json                  — react-icons ^5.6.0
M package-lock.json             — lockfile
A docs/SESSION_HANDOFF_2026_05_28_SPRINT_2_31_LANDING.md  — this file
```

## See also

- Memory: `/memory/session_handoff_sprint_2_31_landing_2026_05_28.md` (canonical session handoff)
- Memory: `/memory/project_landing_icp_vibe_coders.md`
- Memory: `/memory/feedback_landing_voice_tone.md`
- Memory: `/memory/feedback_no_ugc_creation_claim.md`
- Memory: `/memory/project_maya_name_dropped_from_landing.md`
