// Sprint 2 Slice D — ClawHub pin refresh.
//
// Pins removed:
//   - remotion-video-toolkit@1.4.0
//     Operator decision: Remotion is misaligned with Maya's clip-composer
//     surface (heavy React/Lambda toolchain for a creator who needs phone-
//     thumbable clips). NemoVideo is the right pick and will be added in a
//     later slice; the slot is left empty for now rather than back-filled.
//
// Pins kept:
//   - tiktok@3.0.0
//     Judgment: NOT redundant with scrapecreators-api. scrapecreators-api is
//     read-only platform data extraction (110 endpoints across 27 social
//     platforms). The tiktok ClawHub skill is a TikTok Growth OS — strategy,
//     hooks, scripts, retention design, performance review, local content
//     bank. Different surface entirely. The two compose: scrapecreators-api
//     pulls signal, tiktok skill turns signal into hooks/scripts. Per the
//     skill's own SKILL.md ("No API, no posting, no platform automation,
//     local-only storage"), there is zero overlap with our scraping read
//     layer.
//
// Pins added (Sprint 2 Slice D):
//   - vcarolxhberger/free-video-generator-capcut@1.0.0
//   - steipete/video-frames@1.0.0
//   - theplasmak/faster-whisper@1.5.1
//   - paulasjes/elevenlabs-transcribe@1.0.1
//   - psyduckler/instagram-photo-text-overlay@1.0.0
//   - steipete/brave-search@1.0.1
//     (No version specified by operator; pinned to latest stable per
//     ClawHub registry API at slice time.)
//
// File-content hydration note: existing pins (tiktok) carry full SKILL.md
// + supporting files inline because they were materialized via the ClawHub
// CLI before this slice ran. The 6 new pins ship as stub records (metadata
// + descriptive SKILL.md placeholder derived from the public ClawHub
// registry API). The deploy pipeline / a follow-up slice should run
// `npx clawhub install <owner>/<slug>@<version>` for each and replace the
// stubs with the full vendored content. The LOCK + SLUGS arrays are the
// canonical source of truth for what's pinned regardless of hydration
// state, so deploy bundlers can detect stub-state and hydrate.
//
// Sibling-file note: convex/creatorMayaV0/workspaceManifest.ts (Slice A
// territory; do NOT touch from this slice) hardcodes the old pin list in
// TOOLS.md ("remotion-video-toolkit@1.4.0", "tiktok@3.0.0") and in the
// creator-clip-composer skill body. Slice A's deploy-path consolidation
// must rebuild TOOLS.md from this file's LOCK so the prose stays in sync.
// Until then, TOOLS.md will reference a pin that is no longer installed
// and creator-clip-composer will reference remotion. Tracked in HANDOFF.

export interface PinnedClawhubSkill {
  slug: string;
  version: string;
  source: string;
  files: Record<string, string>;
}

export const CREATOR_MAYA_V0_PINNED_CLAWHUB_SKILL_SLUGS = [
  "tiktok",
  "free-video-generator-capcut",
  "video-frames",
  "faster-whisper",
  "elevenlabs-transcribe",
  "instagram-photo-text-overlay",
  "brave-search",
] as const;

export const CREATOR_MAYA_V0_PINNED_CLAWHUB_LOCK = {
  version: 1,
  skills: {
    tiktok: {
      version: "3.0.0",
      source: "clawhub:tiktok",
    },
    "free-video-generator-capcut": {
      version: "1.0.0",
      source: "clawhub:vcarolxhberger/free-video-generator-capcut",
    },
    "video-frames": {
      version: "1.0.0",
      source: "clawhub:steipete/video-frames",
    },
    "faster-whisper": {
      version: "1.5.1",
      source: "clawhub:theplasmak/faster-whisper",
    },
    "elevenlabs-transcribe": {
      version: "1.0.1",
      source: "clawhub:paulasjes/elevenlabs-transcribe",
    },
    "instagram-photo-text-overlay": {
      version: "1.0.0",
      source: "clawhub:psyduckler/instagram-photo-text-overlay",
    },
    "brave-search": {
      version: "1.0.1",
      source: "clawhub:steipete/brave-search",
    },
  },
} as const;

const SLICE_D_PIN_EPOCH_MS = 1778083037000;

interface StubPinInput {
  slug: string;
  owner: string;
  version: string;
  displayName: string;
  description: string;
  source: string;
  homepage?: string;
}

function buildStubPin(input: StubPinInput): PinnedClawhubSkill {
  const originJson = `${JSON.stringify(
    {
      version: 1,
      registry: "https://clawhub.ai",
      slug: input.slug,
      owner: input.owner,
      installedVersion: input.version,
      installedAt: SLICE_D_PIN_EPOCH_MS,
      hydrationState: "stub",
    },
    null,
    2
  )}\n`;
  const metaJson = `${JSON.stringify(
    {
      slug: input.slug,
      owner: input.owner,
      version: input.version,
      publishedAt: SLICE_D_PIN_EPOCH_MS,
    },
    null,
    2
  )}`;
  const skillMd = [
    "---",
    `name: ${input.slug}`,
    `description: ${input.description}`,
    "metadata:",
    "  openclaw:",
    "    hydrationState: stub",
    `    registry: https://clawhub.ai`,
    `    owner: ${input.owner}`,
    `    slug: ${input.slug}`,
    `    version: ${input.version}`,
    "---",
    "",
    `# ${input.displayName}`,
    "",
    `Pinned ClawHub skill: \`${input.owner}/${input.slug}@${input.version}\`.`,
    `Source: ${input.source}`,
    input.homepage ? `Homepage: ${input.homepage}` : "",
    "",
    "## Status",
    "",
    "This entry is a hydration stub. The full SKILL.md body, scripts, and",
    "supporting references are fetched from ClawHub at deploy time via",
    `\`npx clawhub install ${input.owner}/${input.slug}@${input.version}\`.`,
    "Until the deploy pipeline replaces this stub, the agent has only the",
    "summary above and may not be able to invoke registered scripts.",
    "",
    "## Description",
    "",
    input.description,
    "",
  ]
    .filter((line) => line !== "")
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
  return {
    slug: input.slug,
    version: input.version,
    source: input.source,
    files: {
      ".clawhub/origin.json": originJson,
      "_meta.json": metaJson,
      "SKILL.md": `${skillMd}\n`,
    },
  };
}

export const CREATOR_MAYA_V0_PINNED_CLAWHUB_SKILLS: ReadonlyArray<PinnedClawhubSkill> =
  [
    {
      slug: "tiktok",
      version: "3.0.0",
      source: "clawhub:tiktok",
      files: {
        ".clawhub/origin.json":
          '{\n  "version": 1,\n  "registry": "https://clawhub.ai",\n  "slug": "tiktok",\n  "installedVersion": "3.0.0",\n  "installedAt": 1773249218447\n}\n',
        "SKILL.md":
          "---\nname: tiktok\ndescription: Local-first TikTok Growth OS for strategy, hooks, scripts, retention design, and analytics feedback. Use when the user mentions TikTok, short-form video, hooks, scripts, retention, virality, content pillars, series planning, account positioning, or performance review. Generates execution-ready outputs and stores all assets locally. No API, no posting, no platform automation.\n---\n\n# TikTok Growth OS\n\nA local-first operating system for TikTok creators.\nFocus on retention, repeatability, and strategic content design rather than random virality.\n\n## What this skill does\n\nUse this skill when the user wants help with:\n- TikTok niche positioning\n- content pillars\n- video ideas\n- hooks\n- short-form scripts\n- A/V storyboard formatting\n- series planning\n- captions and hashtags\n- retention diagnosis\n- performance pattern review\n\nThis skill should produce execution-ready outputs, not vague inspiration.\n\n## Core operating logic\n\nTikTok growth is treated as a system of controllable variables:\n\n- **Hook strength**: Does the first 1–3 seconds create tension or relevance?\n- **Retention design**: Does the script create momentum and payoff?\n- **Visual pacing**: Is there a pattern interrupt every few seconds?\n- **Audience fit**: Does this feel native to the target viewer?\n- **Series potential**: Can this idea create repeated return behavior?\n- **Data feedback**: What should be repeated, refined, or dropped?\n\nDo not present growth as magic.\nDo not guarantee virality or follower gains.\nAlways frame outputs as strategic guidance.\n\n## Output rules\n\nWhen generating TikTok content, prefer:\n- spoken-language phrasing\n- short sentences\n- immediate tension\n- specific audience fit\n- clear payoff\n- native short-form rhythm\n\nAvoid:\n- essay-style intros\n- generic motivational filler\n- slow setup with no payoff\n- over-explaining before the hook lands\n\n## Default content workflow\n\nWhen the user asks for TikTok help, structure work in this order when relevant:\n\n1. clarify niche or audience if already known from local memory\n2. generate 3–10 content angles\n3. produce 5 hook variations\n4. build one execution-ready script\n5. optionally save the result to local memory\n6. if analytics exist, use prior performance to refine the output\n\n## Hook generation rules\n\nHooks should usually fall into one of these buckets:\n- curiosity gap\n- painful truth\n- contrarian take\n- mistake warning\n- identity-based recognition\n- specific promise\n- emotional confession\n- authority / signal of experience\n\nWhen generating hooks:\n- make each variation meaningfully different\n- label the type\n- explain briefly why it may work\n- avoid repeating the same sentence shape\n\n## Script generation rules\n\nWhen writing TikTok scripts, default to this format:\n\n| Time | Visual | Spoken / Audio | On-Screen Text |\n|------|--------|----------------|----------------|\n\nGuidelines:\n- first 1–3 seconds must carry the hook\n- each segment should add tension, clarity, or payoff\n- include pattern interrupts where useful\n- optimize for vertical, short-form pacing\n- include CTA only if it fits naturally\n\n## Performance review rules\n\nIf the user provides metrics or performance context, diagnose using first principles such as:\n- weak opening\n- slow payoff\n- too much setup\n- vague topic framing\n- mismatch between title/hook and delivery\n- insufficient visual momentum\n- weak emotional or practical value\n- unclear audience targeting\n\n## Local memory\n\nAll files are stored locally only in:\n\n`~/.openclaw/workspace/memory/tiktok/`\n\nFiles:\n- `profile.json` — niche, audience, goals, pillars\n- `content_bank.json` — saved ideas, hooks, scripts, captions, notes\n- `analytics.json` — manually logged video performance\n- `pattern_report.json` — latest summarized learning report\n\n## Scripts\n\n| Script | Purpose |\n|--------|---------|\n| `scripts/manage_account.py` | Create or update account profile |\n| `scripts/save_content.py` | Save ideas, hooks, scripts, captions, or notes |\n| `scripts/list_content.py` | Browse local content assets |\n| `scripts/log_performance.py` | Log manual TikTok performance data |\n| `scripts/analyze_patterns.py` | Summarize local performance patterns |\n\n## References\n\n- `references/hooks.md`\n- `references/retention.md`\n\n## Safety boundaries\n\n- Local-only storage\n- No TikTok API\n- No account login\n- No posting\n- No scraping\n- No engagement automation\n- No claims of guaranteed virality\n\nThe user is responsible for final review, posting, and platform compliance.\n",
        "_meta.json":
          '{\n  "ownerId": "kn742g1df3ade63yv4z42zggj582eg2h",\n  "slug": "tiktok",\n  "version": "3.0.0",\n  "publishedAt": 1773249218447\n}',
        "references/hooks.md":
          "# Hooks\n\nA good TikTok hook earns attention in the first 1–3 seconds.\n\n## Core hook types\n\n### 1. Curiosity gap\nOpen a loop the viewer wants closed.\nExample:\n- Nobody tells you this about healing after rejection.\n- This is why your content feels invisible.\n\n### 2. Pain point\nName a frustration fast.\nExample:\n- You're not lazy. Your system is broken.\n- Most people are failing because they start here.\n\n### 3. Contrarian\nChallenge an assumed truth.\nExample:\n- Consistency is not your real problem.\n- Stop trying to be relatable on TikTok.\n\n### 4. Identity recognition\nMake the viewer feel seen.\nExample:\n- If you're the friend who always overthinks texts, listen.\n- This is for creators who are tired of posting into the void.\n\n### 5. Specific promise\nOffer a concrete payoff.\nExample:\n- Here are 3 ways to make a boring topic addictive.\n- I'll show you how to fix your first 3 seconds.\n\n## Hook rules\n- specificity beats vagueness\n- tension beats explanation\n- relevance beats cleverness\n- speed beats polish\n",
        "references/retention.md":
          "# Retention\n\nRetention is not only about editing speed.\nIt is about controlled momentum.\n\n## Core retention principles\n\n### 1. Fast entry\nDo not spend 5 seconds warming up.\nEnter with tension, a claim, a problem, or a visible shift.\n\n### 2. Payoff pacing\nGive the viewer a reason to stay within the first few seconds.\nDo not delay all value until the end.\n\n### 3. Pattern interrupts\nEvery few seconds, introduce one of:\n- new information\n- visual shift\n- text emphasis\n- stronger claim\n- emotional turn\n- contrast\n\n### 4. Compression\nRemove anything that does not increase curiosity, clarity, or payoff.\n\n### 5. Viewer orientation\nThe viewer should always know:\n- what this is about\n- why it matters\n- what they get by staying\n\n## Weak retention signs\n- slow setup\n- vague topic framing\n- repeated sentence rhythm\n- too much context before value\n- mismatch between opening and delivery\n- no emotional or practical reward\n",
        "scripts/analyze_patterns.py":
          '#!/usr/bin/env python3\nimport os\nimport sys\n\nsys.path.append(os.path.dirname(os.path.dirname(__file__)))\n\nfrom collections import defaultdict\nfrom statistics import mean\nfrom scripts.lib.storage import load_json, save_json\nfrom scripts.lib.schema import now_iso\nfrom scripts.lib.output import print_header\n\n\ndef avg(values):\n    return round(mean(values), 2) if values else 0.0\n\n\ndef top_group(videos, field):\n    grouped = defaultdict(list)\n    for v in videos:\n        key = (v.get(field) or "unknown").strip() or "unknown"\n        grouped[key].append(v)\n\n    scored = []\n    for key, items in grouped.items():\n        scored.append({\n            "name": key,\n            "count": len(items),\n            "avg_views": avg([i.get("views", 0) for i in items]),\n            "avg_completion": avg([i.get("completion_rate", 0.0) for i in items]),\n            "avg_engagement": avg([\n                i.get("likes", 0) + i.get("comments", 0) + i.get("shares", 0) for i in items\n            ]),\n        })\n\n    scored.sort(key=lambda x: (x["avg_completion"], x["avg_views"]), reverse=True)\n    return scored\n\n\ndef build_recommendations(videos):\n    recs = []\n    if not videos:\n        return ["No analytics logged yet. Start logging results to generate local pattern insights."]\n\n    overall_completion = avg([v.get("completion_rate", 0.0) for v in videos])\n    overall_views = avg([v.get("views", 0) for v in videos])\n\n    if overall_completion < 30:\n        recs.append("Average completion is low. Tighten the first 1–3 seconds and reduce setup before payoff.")\n    elif overall_completion < 45:\n        recs.append("Completion is moderate. Add stronger pattern interrupts and clearer payoff earlier.")\n    else:\n        recs.append("Completion is relatively strong. Double down on similar pacing and framing structures.")\n\n    if overall_views < 5000:\n        recs.append("Average views are still modest. Test stronger hooks and more specific audience framing.")\n    else:\n        recs.append("Some topics are gaining traction. Compare top-performing angles and repeat the strongest framing.")\n\n    return recs\n\n\ndef main():\n    analytics = load_json("analytics")\n    videos = analytics.get("videos", [])\n\n    by_angle = top_group(videos, "angle")\n    by_hook = top_group(videos, "hook_type")\n    by_topic = top_group(videos, "topic")\n    recs = build_recommendations(videos)\n\n    report = {\n        "generated_at": now_iso(),\n        "summary": {\n            "total_videos": len(videos),\n            "top_angles": by_angle[:5],\n            "top_hook_types": by_hook[:5],\n            "top_topics": by_topic[:5],\n        },\n        "recommendations": recs,\n    }\n\n    save_json("pattern_report", report)\n\n    print_header("📈 TIKTOK PATTERN REPORT")\n    print(f"Generated: {report[\'generated_at\']}")\n    print(f"Videos analyzed: {report[\'summary\'][\'total_videos\']}")\n\n    print("\\nTop Angles:")\n    if by_angle:\n        for item in by_angle[:5]:\n            print(f"- {item[\'name\']} | count={item[\'count\']} | avg_views={item[\'avg_views\']} | avg_completion={item[\'avg_completion\']}")\n    else:\n        print("- No data")\n\n    print("\\nTop Hook Types:")\n    if by_hook:\n        for item in by_hook[:5]:\n            print(f"- {item[\'name\']} | count={item[\'count\']} | avg_views={item[\'avg_views\']} | avg_completion={item[\'avg_completion\']}")\n    else:\n        print("- No data")\n\n    print("\\nRecommendations:")\n    for rec in recs:\n        print(f"- {rec}")\n\n\nif __name__ == "__main__":\n    main()\n',
        "scripts/lib/__init__.py": "# TikTok Growth OS library package\n",
        "scripts/lib/output.py":
          '#!/usr/bin/env python3\nfrom typing import Iterable\n\n\ndef print_header(title: str) -> None:\n    print(f"\\n{title}")\n    print("=" * len(title))\n\n\ndef print_kv(label: str, value: str) -> None:\n    print(f"{label}: {value}")\n\n\ndef print_list(items: Iterable[str], prefix: str = "- ") -> None:\n    for item in items:\n        print(f"{prefix}{item}")\n',
        "scripts/lib/schema.py":
          '#!/usr/bin/env python3\nfrom datetime import datetime\nfrom typing import Dict, Any, List, Optional\nimport uuid\n\n\ndef now_iso() -> str:\n    return datetime.now().isoformat()\n\n\ndef make_content_item(\n    item_type: str,\n    title: str,\n    content: str,\n    tags: Optional[List[str]] = None,\n    topic: str = "",\n    angle: str = "",\n    notes: str = ""\n) -> Dict[str, Any]:\n    return {\n        "id": f"TK-{uuid.uuid4().hex[:8].upper()}",\n        "type": item_type,\n        "title": title,\n        "content": content,\n        "topic": topic,\n        "angle": angle,\n        "tags": tags or [],\n        "notes": notes,\n        "created_at": now_iso()\n    }\n\n\ndef make_video_log(\n    video_title: str,\n    topic: str,\n    angle: str,\n    hook_type: str,\n    views: int,\n    likes: int,\n    comments: int,\n    shares: int,\n    completion_rate: float,\n    notes: str = ""\n) -> Dict[str, Any]:\n    return {\n        "id": f"VID-{uuid.uuid4().hex[:8].upper()}",\n        "video_title": video_title,\n        "topic": topic,\n        "angle": angle,\n        "hook_type": hook_type,\n        "views": views,\n        "likes": likes,\n        "comments": comments,\n        "shares": shares,\n        "completion_rate": completion_rate,\n        "notes": notes,\n        "logged_at": now_iso()\n    }\n',
        "scripts/lib/storage.py":
          '#!/usr/bin/env python3\nimport json\nimport os\nfrom typing import Any, Dict\n\nBASE_DIR = os.path.expanduser("~/.openclaw/workspace/memory/tiktok")\n\nFILES = {\n    "profile": "profile.json",\n    "content_bank": "content_bank.json",\n    "analytics": "analytics.json",\n    "pattern_report": "pattern_report.json",\n}\n\n\ndef ensure_base_dir() -> None:\n    os.makedirs(BASE_DIR, exist_ok=True)\n\n\ndef path_for(key: str) -> str:\n    if key not in FILES:\n        raise ValueError(f"Unknown storage key: {key}")\n    ensure_base_dir()\n    return os.path.join(BASE_DIR, FILES[key])\n\n\ndef default_data(key: str) -> Dict[str, Any]:\n    defaults = {\n        "profile": {\n            "niche": "",\n            "target_audience": "",\n            "primary_goal": "",\n            "pillars": [],\n            "tone": "",\n            "notes": "",\n            "updated_at": ""\n        },\n        "content_bank": {\n            "items": []\n        },\n        "analytics": {\n            "videos": []\n        },\n        "pattern_report": {\n            "generated_at": "",\n            "summary": {},\n            "recommendations": []\n        },\n    }\n    return defaults[key]\n\n\ndef load_json(key: str) -> Dict[str, Any]:\n    file_path = path_for(key)\n    if not os.path.exists(file_path):\n        return default_data(key)\n\n    with open(file_path, "r", encoding="utf-8") as f:\n        return json.load(f)\n\n\ndef save_json(key: str, data: Dict[str, Any]) -> None:\n    file_path = path_for(key)\n    with open(file_path, "w", encoding="utf-8") as f:\n        json.dump(data, f, indent=2, ensure_ascii=False)\n',
        "scripts/list_content.py":
          '#!/usr/bin/env python3\nimport os\nimport sys\n\nsys.path.append(os.path.dirname(os.path.dirname(__file__)))\n\nimport argparse\nfrom scripts.lib.storage import load_json\nfrom scripts.lib.output import print_header\n\n\ndef matches(item: dict, item_type: str, topic: str, tag: str) -> bool:\n    if item_type and item.get("type") != item_type:\n        return False\n    if topic and topic.lower() not in item.get("topic", "").lower():\n        return False\n    if tag and tag.lower() not in [t.lower() for t in item.get("tags", [])]:\n        return False\n    return True\n\n\ndef main() -> None:\n    parser = argparse.ArgumentParser(description="List saved TikTok content assets.")\n    parser.add_argument("--type", default="", choices=["", "idea", "hook", "script", "caption", "note"], help="Filter by type")\n    parser.add_argument("--topic", default="", help="Filter by topic contains")\n    parser.add_argument("--tag", default="", help="Filter by tag")\n    parser.add_argument("--limit", type=int, default=20, help="Max items to show")\n\n    args = parser.parse_args()\n\n    bank = load_json("content_bank")\n    items = [item for item in bank.get("items", []) if matches(item, args.type, args.topic, args.tag)]\n    items = sorted(items, key=lambda x: x.get("created_at", ""), reverse=True)[: args.limit]\n\n    print_header("📚 SAVED CONTENT")\n    if not items:\n        print("No matching content found.")\n        return\n\n    for idx, item in enumerate(items, start=1):\n        print(f"\\n{idx}. [{item.get(\'type\', \'\').upper()}] {item.get(\'title\', \'\')}")\n        print(f"   ID: {item.get(\'id\', \'\')}")\n        print(f"   Topic: {item.get(\'topic\', \'\')}")\n        print(f"   Angle: {item.get(\'angle\', \'\')}")\n        print(f"   Tags: {\', \'.join(item.get(\'tags\', []))}")\n        print(f"   Created: {item.get(\'created_at\', \'\')}")\n        preview = item.get("content", "").replace("\\n", " ")\n        print(f"   Preview: {preview[:140]}{\'...\' if len(preview) > 140 else \'\'}")\n\n\nif __name__ == "__main__":\n    main()\n',
        "scripts/log_performance.py":
          '#!/usr/bin/env python3\nimport os\nimport sys\n\nsys.path.append(os.path.dirname(os.path.dirname(__file__)))\n\nimport argparse\nfrom scripts.lib.storage import load_json, save_json\nfrom scripts.lib.schema import make_video_log\nfrom scripts.lib.output import print_header, print_kv\n\n\ndef non_negative_int(value: str) -> int:\n    ivalue = int(value)\n    if ivalue < 0:\n        raise argparse.ArgumentTypeError("Value must be non-negative.")\n    return ivalue\n\n\ndef completion_percent(value: str) -> float:\n    fvalue = float(value)\n    if fvalue < 0 or fvalue > 100:\n        raise argparse.ArgumentTypeError("Completion rate must be between 0 and 100.")\n    return fvalue\n\n\ndef main() -> None:\n    parser = argparse.ArgumentParser(description="Log TikTok performance metrics locally.")\n    parser.add_argument("--title", required=True, help="Video title")\n    parser.add_argument("--topic", default="", help="Topic")\n    parser.add_argument("--angle", default="", help="Angle")\n    parser.add_argument("--hook-type", default="", help="Hook type used")\n    parser.add_argument("--views", required=True, type=non_negative_int, help="Views")\n    parser.add_argument("--likes", type=non_negative_int, default=0, help="Likes")\n    parser.add_argument("--comments", type=non_negative_int, default=0, help="Comments")\n    parser.add_argument("--shares", type=non_negative_int, default=0, help="Shares")\n    parser.add_argument("--completion", required=True, type=completion_percent, help="Completion rate percent")\n    parser.add_argument("--notes", default="", help="Notes")\n\n    args = parser.parse_args()\n\n    analytics = load_json("analytics")\n    entry = make_video_log(\n        video_title=args.title.strip(),\n        topic=args.topic.strip(),\n        angle=args.angle.strip(),\n        hook_type=args.hook_type.strip(),\n        views=args.views,\n        likes=args.likes,\n        comments=args.comments,\n        shares=args.shares,\n        completion_rate=args.completion,\n        notes=args.notes.strip(),\n    )\n\n    analytics["videos"].append(entry)\n    save_json("analytics", analytics)\n\n    print_header("✅ PERFORMANCE LOGGED")\n    print_kv("ID", entry["id"])\n    print_kv("Title", entry["video_title"])\n    print_kv("Views", str(entry["views"]))\n    print_kv("Completion %", str(entry["completion_rate"]))\n    print_kv("Logged At", entry["logged_at"])\n\n\nif __name__ == "__main__":\n    main()\n',
        "scripts/manage_account.py":
          '#!/usr/bin/env python3\nimport os\nimport sys\n\nsys.path.append(os.path.dirname(os.path.dirname(__file__)))\n\nimport argparse\nfrom scripts.lib.storage import load_json, save_json\nfrom scripts.lib.output import print_header, print_kv\nfrom scripts.lib.schema import now_iso\n\n\ndef main() -> None:\n    parser = argparse.ArgumentParser(description="Create or update TikTok account profile.")\n    parser.add_argument("--niche", default="", help="Account niche")\n    parser.add_argument("--audience", default="", help="Target audience")\n    parser.add_argument("--goal", default="", help="Primary goal")\n    parser.add_argument("--pillars", default="", help=\'Comma-separated content pillars, e.g. "stories,education,hot takes"\')\n    parser.add_argument("--tone", default="", help="Voice or tone")\n    parser.add_argument("--notes", default="", help="Additional notes")\n\n    args = parser.parse_args()\n\n    profile = load_json("profile")\n\n    if args.niche:\n        profile["niche"] = args.niche.strip()\n    if args.audience:\n        profile["target_audience"] = args.audience.strip()\n    if args.goal:\n        profile["primary_goal"] = args.goal.strip()\n    if args.pillars:\n        profile["pillars"] = [p.strip() for p in args.pillars.split(",") if p.strip()]\n    if args.tone:\n        profile["tone"] = args.tone.strip()\n    if args.notes:\n        profile["notes"] = args.notes.strip()\n\n    profile["updated_at"] = now_iso()\n    save_json("profile", profile)\n\n    print_header("✅ TIKTOK ACCOUNT PROFILE UPDATED")\n    print_kv("Niche", profile.get("niche", ""))\n    print_kv("Audience", profile.get("target_audience", ""))\n    print_kv("Goal", profile.get("primary_goal", ""))\n    print_kv("Pillars", ", ".join(profile.get("pillars", [])))\n    print_kv("Tone", profile.get("tone", ""))\n    print_kv("Updated At", profile.get("updated_at", ""))\n\n\nif __name__ == "__main__":\n    main()\n',
        "scripts/save_content.py":
          '#!/usr/bin/env python3\nimport os\nimport sys\n\nsys.path.append(os.path.dirname(os.path.dirname(__file__)))\n\nimport argparse\nfrom scripts.lib.storage import load_json, save_json\nfrom scripts.lib.schema import make_content_item\nfrom scripts.lib.output import print_header, print_kv\n\n\ndef main() -> None:\n    parser = argparse.ArgumentParser(description="Save TikTok content asset to local bank.")\n    parser.add_argument("--type", required=True, choices=["idea", "hook", "script", "caption", "note"], help="Content type")\n    parser.add_argument("--title", required=True, help="Short title for the asset")\n    parser.add_argument("--content", required=True, help="Main content body")\n    parser.add_argument("--topic", default="", help="Topic")\n    parser.add_argument("--angle", default="", help="Angle or framing")\n    parser.add_argument("--tags", default="", help=\'Comma-separated tags, e.g. "dating,contrarian,hook"\')\n    parser.add_argument("--notes", default="", help="Extra notes")\n\n    args = parser.parse_args()\n\n    bank = load_json("content_bank")\n    tags = [t.strip() for t in args.tags.split(",") if t.strip()]\n\n    item = make_content_item(\n        item_type=args.type,\n        title=args.title.strip(),\n        content=args.content.strip(),\n        topic=args.topic.strip(),\n        angle=args.angle.strip(),\n        tags=tags,\n        notes=args.notes.strip(),\n    )\n\n    bank["items"].append(item)\n    save_json("content_bank", bank)\n\n    print_header("✅ CONTENT SAVED")\n    print_kv("ID", item["id"])\n    print_kv("Type", item["type"])\n    print_kv("Title", item["title"])\n    print_kv("Topic", item["topic"])\n    print_kv("Angle", item["angle"])\n    print_kv("Tags", ", ".join(item["tags"]))\n\n\nif __name__ == "__main__":\n    main()\n',
        "skill.json":
          '{\n  "name": "tiktok",\n  "version": "3.0.0",\n  "description": "Local-first TikTok Growth OS for strategy, hooks, scripts, retention design, and analytics feedback. Generates execution-ready short-form outputs and stores all assets locally. No API, no posting, no platform automation.",\n  "author": "cj"\n}\n',
      },
    },
    buildStubPin({
      slug: "free-video-generator-capcut",
      owner: "vcarolxhberger",
      version: "1.0.0",
      displayName: "Free Video Generator CapCut",
      description:
        "Get edited video clips ready to post, without touching a single slider. Upload your video clips or images (MP4, MOV, AVI, WebM, up to 500MB), say what you want, and the cloud workflow returns a 1080p MP4. CapCut-style export for TikTok, Reels, and short-form video creators.",
      source: "https://clawhub.ai/skills/vcarolxhberger/free-video-generator-capcut",
    }),
    buildStubPin({
      slug: "video-frames",
      owner: "steipete",
      version: "1.0.0",
      displayName: "Video Frames",
      description:
        "Extract frames or short clips from videos using ffmpeg. Use when Maya needs thumbnail frames, sampled stills for multimodal analysis, or a short reference clip from a longer source video.",
      source: "https://clawhub.ai/skills/steipete/video-frames",
    }),
    buildStubPin({
      slug: "faster-whisper",
      owner: "theplasmak",
      version: "1.5.1",
      displayName: "Faster Whisper",
      description:
        "Local speech-to-text using faster-whisper. 4-6x faster than OpenAI Whisper with identical accuracy; GPU acceleration enables ~20x realtime transcription. Supports SRT/VTT/text outputs, batch transcription, and optional speaker diarization.",
      source: "https://clawhub.ai/skills/theplasmak/faster-whisper",
    }),
    buildStubPin({
      slug: "elevenlabs-transcribe",
      owner: "paulasjes",
      version: "1.0.1",
      displayName: "ElevenLabs Transcribe",
      description:
        "Transcribe audio to text using ElevenLabs Scribe. Supports batch transcription, realtime streaming from URLs, microphone input, and local files. Use when Maya needs higher-accuracy transcription than local Whisper or when latency matters.",
      source: "https://clawhub.ai/skills/paulasjes/elevenlabs-transcribe",
    }),
    buildStubPin({
      slug: "instagram-photo-text-overlay",
      owner: "psyduckler",
      version: "1.0.0",
      displayName: "Instagram Photo Text Overlay",
      description:
        "Overlay text on photos for Instagram posts. Generates portrait (4:5) images with gradient overlays, titles, and optional numbered lists. Use when Maya needs a quick text-on-image asset for Instagram or carousel posts.",
      source: "https://clawhub.ai/skills/psyduckler/instagram-photo-text-overlay",
    }),
    buildStubPin({
      slug: "brave-search",
      owner: "steipete",
      version: "1.0.1",
      displayName: "Brave Search",
      description:
        "Web search and content extraction via Brave Search API. Use for searching documentation, facts, or any web content. Lightweight, no browser required. Pinned to latest stable (1.0.1) at slice time; no version was specified by the operator.",
      source: "https://clawhub.ai/skills/steipete/brave-search",
    }),
  ];
