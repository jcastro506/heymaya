#!/usr/bin/env tsx
/**
 * Maya Telegram demo — real-world social-media-manager test.
 *
 * Bypasses the full OpenClaw + Fly deploy (operator-blocked) and runs Maya's
 * core creator-manager behaviors as a standalone Node script. Each behavior:
 *   1. Is grounded in a mocked mid-tier creator picture (15K TikTok, fitness
 *      for new dads niche).
 *   2. Calls Gemini 3 Flash via OpenRouter at the appropriate thinking
 *      budget per `playbook.md` (none for chat, medium for morning brief,
 *      high for weekly synth).
 *   3. Pushes the output to the operator's Telegram via the test bot.
 *
 * This is NOT a substitute for the full OpenClaw runtime — it's a
 * demonstration that Maya's CONTENT and TONE work end-to-end on a real
 * channel, before we wire OpenClaw's full per-creator deploy pipeline.
 *
 * Required env (read from .env.local via dotenv if invoked directly):
 *   - OPENROUTER_API_KEY
 *   - OPENROUTER_DEFAULT_MODEL (defaults to google/gemini-2.5-flash if unset)
 *   - TELEGRAM_BOT_TOKEN
 *   - TELEGRAM_OPERATOR_CHAT_ID
 *
 * Usage:
 *   npx tsx scripts/maya-telegram-creator-demo.ts
 *   npx tsx scripts/maya-telegram-creator-demo.ts --behavior morning_brief
 *   npx tsx scripts/maya-telegram-creator-demo.ts --dry-run     (no Telegram send, prints only)
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/* -------------------------------------------------------------------------- */
/* Env loading — minimal .env.local parser (no dotenv dep)                    */
/* -------------------------------------------------------------------------- */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadDotEnv(): void {
  const envPath = resolve(REPO_ROOT, ".env.local");
  if (!existsSync(envPath)) return;
  const src = readFileSync(envPath, "utf8");
  for (const line of src.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

loadDotEnv();

/* -------------------------------------------------------------------------- */
/* Mocked creator picture — Riley, 15K TikTok, fitness for new dads           */
/* -------------------------------------------------------------------------- */

const RILEY_PICTURE = {
  name: "Riley",
  primaryHandle: "@dadstrong_test",
  platform: "tiktok" as const,
  followers: 15_400,
  followerBracket: "10K-50K",
  niche: "fitness for new dads",
  subNiches: ["postpartum dad recovery", "5-min home workouts", "dad-baby workout combos"],
  voice: "warm, no-bullshit, slightly self-deprecating, occasional gym-bro slang sparingly",
  goals: {
    primary: "grow to 100K followers",
    secondary: "land first 4-figure brand deal",
    timeline: "9 months",
  },
  weeklyHours: 8,
  tonePreference: "strategic" as const,
  brandDealFloor: 1500, // USD per integration
  topHooks: [
    'POV: it\'s 4am, baby\'s asleep, and you have exactly 7 minutes — here\'s what I do',
    'Three exercises every new dad should do before the 6-week mark',
    'The dumbbell move that fixed my back after 6 months of carrying her',
  ],
  bottomHooks: [
    'My morning routine as a new dad', // too generic
    'How I balance fatherhood and fitness', // platitude
  ],
  recentPosts: [
    {
      id: "tt_2026_05_01_a",
      caption: 'POV: 4am wake-up + 7 minutes — here\'s the routine',
      views: 47200,
      likes: 4_180,
      comments: 312,
      saves: 891,
      postedAt: "2026-05-01T04:18:00Z",
      hookPattern: "POV constraint hook",
    },
    {
      id: "tt_2026_04_30_a",
      caption: "Bench press but my daughter is the weight",
      views: 8_900,
      likes: 612,
      comments: 47,
      saves: 38,
      postedAt: "2026-04-30T18:00:00Z",
      hookPattern: "novelty visual",
    },
    {
      id: "tt_2026_04_28_a",
      caption: "How I balance fatherhood and fitness",
      views: 2_100,
      likes: 89,
      comments: 4,
      saves: 6,
      postedAt: "2026-04-28T17:30:00Z",
      hookPattern: "platitude",
    },
  ],
  competitorWatch: [
    { handle: "@dadbod_to_godbod", followers: 87_000, recentTopHook: "what your wife actually wants you to look like at 35" },
    { handle: "@5min.dad.fit", followers: 41_000, recentTopHook: "the only ab move new dads should do (your back will thank you)" },
  ],
  openCommitments: [
    { id: "cm_1", description: "Post 3 TikToks this week", deadline: "2026-05-04T23:59:00Z", status: "1 of 3 posted" },
    { id: "cm_2", description: "Reply to 5 DMs that mention training programs", deadline: "2026-05-04T23:59:00Z", status: "0 of 5 replied" },
  ],
  niche_trends: [
    {
      observation: "POV-style 'limited time' hooks ('4am, 7 minutes', '5 min before baby wakes') are spiking in fitness-for-dads — top performer this week is @dadbod_to_godbod with 312K views on 'POV: kid is at school for 90 min, here's chest day'",
      sourcePost: "https://tiktok.com/@dadbod_to_godbod/video/2026_04_29_a",
      fitScore: "high — matches your top-performer hook pattern + voice",
    },
    {
      observation: "Anti-bro-fitness sentiment growing in dad-fitness comments — creators leaning into 'I'm not your alpha brother, I'm just trying to bench more than my baby weighs' style are getting 3-5× engagement",
      sourcePost: "https://tiktok.com/@5min.dad.fit/video/2026_04_27_b",
      fitScore: "medium — matches your self-deprecating voice but you'd need to commit harder to it",
    },
  ],
};

/* -------------------------------------------------------------------------- */
/* OpenRouter client — minimal, mirrors convex/agents/modelRouter shape       */
/* -------------------------------------------------------------------------- */

const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
// OpenRouter currently lists Gemini 3 Flash as `google/gemini-3-flash-preview`
// (the repo's `OPENROUTER_DEFAULT_MODEL=google/gemini-3-flash` works through
// OpenRouter's resolution but only sometimes — preview suffix is the safer
// id for direct calls). Allow operator override via env.
const DEFAULT_MODEL =
  process.env.MAYA_DEMO_MODEL ??
  process.env.OPENROUTER_DEFAULT_MODEL ??
  "google/gemini-3-flash-preview";

type ThinkingBudget = "none" | "low" | "medium" | "high";

async function callMaya(
  systemPrompt: string,
  userPrompt: string,
  budget: ThinkingBudget
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY not set — check .env.local");
  }
  const reasoning =
    budget === "none" ? { enabled: false } : { effort: budget };
  const res = await fetch(OPENROUTER_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://hey-maya.ai",
      "X-Title": "HeyMaya Telegram demo",
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      reasoning,
      // Gemini via OpenRouter counts reasoning tokens against max_tokens —
      // bump generously so 200-word outputs aren't clipped at "length".
      max_tokens: 6000,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!content) throw new Error("OpenRouter returned empty content");
  return content;
}

/* -------------------------------------------------------------------------- */
/* Telegram client                                                            */
/* -------------------------------------------------------------------------- */

async function sendTelegram(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_OPERATOR_CHAT_ID;
  if (!token || !chatId) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN or TELEGRAM_OPERATOR_CHAT_ID not set — check .env.local"
    );
  }
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram ${res.status}: ${body.slice(0, 300)}`);
  }
}

/* -------------------------------------------------------------------------- */
/* Maya behaviors — ported from playbook.md                                   */
/* -------------------------------------------------------------------------- */

const SOUL_BLOCK = `You are Maya — Riley's AI creator manager. You are NOT a generic AI assistant.

Voice: warm, direct, slightly dry. You text Riley like a smart friend who happens to know his data inside out. No exclamation point spam. No "let's crush it!" energy. No platitudes. No bullet salads — write like you'd text. Mobile-first, under 200 words unless explicitly asked for long-form.

Anti-sycophancy is non-negotiable: you never say "great question" or "amazing post". If a post underperforms you say so plainly, with the data, and then propose what's next. If you don't have data, you don't pretend.

Grounded or silent: every claim about Riley's account cites a specific number, post id, or named comparable. If you can't ground a claim, you don't make it. Better to send 3 grounded sentences than 5 with one made-up stat.

Format your replies for Telegram (markdown supported — use *bold*, _italic_, sparingly).

Riley's context (you have full access to this; cite specifics naturally):
${JSON.stringify(RILEY_PICTURE, null, 2)}`;

interface Behavior {
  name: string;
  thinkingBudget: ThinkingBudget;
  userPrompt: string;
  preface: string; // small header line so the operator can tell which behavior fired
}

const BEHAVIORS: Record<string, Behavior> = {
  activation_ping: {
    name: "activation_ping",
    thinkingBudget: "low",
    preface: "🔔 *Activation* — first ping after deploy",
    userPrompt: `It's the first time you're texting Riley after his Maya was deployed (he just finished onboarding 3 minutes ago). Introduce yourself in 2-3 sentences, name ONE specific data point from his account that caught your eye, and ask the one question you most need answered to be useful tomorrow morning. Don't list your features. Don't say "I'm here to help" — show it.`,
  },
  morning_brief: {
    name: "morning_brief",
    thinkingBudget: "medium",
    preface: "☀️ *Morning brief* — 7am local",
    userPrompt: `Write Riley's morning brief for today. Per playbook.md § 5.1: lead with one specific data point from yesterday (cite post id or specific number), then ONE thing to do today (cited / reasoned), then any pending items needing approval (he has the open commitments listed in his picture). Single closing line in tone. Under 200 words. Mobile format. No bullet salad.`,
  },
  post_publish_reaction: {
    name: "post_publish_reaction",
    thinkingBudget: "medium",
    preface: "📈 *Post-publish reaction* — Riley's 4am Reel just hit 47k",
    userPrompt: `Riley's 4am Reel (id tt_2026_05_01_a) just crossed 47.2k views with 4,180 likes / 312 comments / 891 saves in 18 hours — that's 3.07x his trailing 30-day average view count. Run the post-publish reaction per playbook.md § 5.2: one sentence on what hook pattern he used, one sentence on whether it tracks with his top-performers, one specific suggestion. Don't gush — early metrics are noise vs lifetime, hold judgment for the 2h check. Reference specific numbers from his picture.`,
  },
  niche_scan: {
    name: "niche_scan",
    thinkingBudget: "low",
    preface: "📡 *Daily niche scan* — 6pm local",
    userPrompt: `Run today's niche scan per playbook.md § 5.4. The trends you observed in Riley's niche today are listed in niche_trends in his picture. Surface the top 1-2 to him with citations. Don't push the low-fit ones. Each observation cites the source post or hashtag and notes why it fits his voice. Avoid trend-chasing for trend-chasing's sake — fit beats novelty.`,
  },
  accountability_nudge: {
    name: "accountability_nudge",
    thinkingBudget: "low",
    preface: "🎯 *Accountability nudge* — open commitment past midweek",
    userPrompt: `Riley committed to 3 TikToks this week. Today is Saturday. He has posted 1 (tt_2026_05_01_a, his 4am Reel). Per playbook.md § 5.7, run the accountability nudge — tone-adjusted (his tonePreference is "strategic" — not tough-love, not pure-supportive — direct + propose a concrete unblock). Never nag without a new angle: propose something specific from his top-performer hook to make it easy to start. Under 80 words.`,
  },
  evening_recap: {
    name: "evening_recap",
    thinkingBudget: "low",
    preface: "🌙 *Evening recap* — 7pm local",
    userPrompt: `Write Riley's evening recap per playbook.md § 5.8. Three lines max. What happened today (one cited fact — pick from his picture), what's pending overnight (open commitments, any deal drafts — he has none today), and one thing to think about for tomorrow. If the day was quiet say so plainly.`,
  },
};

/* -------------------------------------------------------------------------- */
/* CLI                                                                        */
/* -------------------------------------------------------------------------- */

interface Flags {
  behavior: string | null;
  dryRun: boolean;
  delaySec: number;
  help: boolean;
}

function parseFlags(argv: string[]): Flags {
  const out: Flags = { behavior: null, dryRun: false, delaySec: 4, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--behavior" || a === "-b") {
      out.behavior = argv[++i] ?? null;
    } else if (a === "--dry-run") {
      out.dryRun = true;
    } else if (a === "--delay") {
      out.delaySec = Number(argv[++i] ?? 4);
    } else if (a === "--help" || a === "-h") {
      out.help = true;
    }
  }
  return out;
}

function printHelp(): void {
  // eslint-disable-next-line no-console
  console.log(`maya-telegram-creator-demo

Run Maya's core creator-manager behaviors as a standalone demo, sending each
output to the operator's Telegram via the test bot.

Options:
  --behavior <name>   Run only the named behavior. Available: ${Object.keys(BEHAVIORS).join(", ")}
  --dry-run           Print to stdout, do NOT send to Telegram
  --delay <sec>       Seconds to wait between behaviors when running all (default 4)
  --help              Show this help

Examples:
  npx tsx scripts/maya-telegram-creator-demo.ts                          # all behaviors, ~30s total
  npx tsx scripts/maya-telegram-creator-demo.ts --behavior morning_brief # one behavior
  npx tsx scripts/maya-telegram-creator-demo.ts --dry-run                # no Telegram sends
`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function runBehavior(b: Behavior, dryRun: boolean): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`\n→ ${b.name} (thinking=${b.thinkingBudget})`);
  const t0 = Date.now();
  const body = await callMaya(SOUL_BLOCK, b.userPrompt, b.thinkingBudget);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  // eslint-disable-next-line no-console
  console.log(`  generated in ${elapsed}s, ${body.length} chars`);
  const message = `${b.preface}\n\n${body}`;
  if (dryRun) {
    // eslint-disable-next-line no-console
    console.log("  [DRY RUN] would send:\n" + message + "\n");
    return;
  }
  await sendTelegram(message);
  // eslint-disable-next-line no-console
  console.log(`  ✓ delivered to Telegram`);
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.help) {
    printHelp();
    return;
  }

  // eslint-disable-next-line no-console
  console.log("Maya Telegram demo — Riley (15K TikTok, fitness for new dads)");
  // eslint-disable-next-line no-console
  console.log(
    `model: ${DEFAULT_MODEL} · dry-run: ${flags.dryRun} · target chat: ${
      flags.dryRun ? "—" : process.env.TELEGRAM_OPERATOR_CHAT_ID
    }`
  );

  if (flags.behavior) {
    const b = BEHAVIORS[flags.behavior];
    if (!b) {
      // eslint-disable-next-line no-console
      console.error(
        `unknown behavior '${flags.behavior}' — available: ${Object.keys(BEHAVIORS).join(", ")}`
      );
      process.exit(1);
    }
    await runBehavior(b, flags.dryRun);
    return;
  }

  const order = [
    "activation_ping",
    "morning_brief",
    "post_publish_reaction",
    "niche_scan",
    "accountability_nudge",
    "evening_recap",
  ];
  for (const name of order) {
    const b = BEHAVIORS[name];
    if (!b) continue;
    await runBehavior(b, flags.dryRun);
    if (name !== order[order.length - 1]) {
      await sleep(flags.delaySec * 1000);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: Error) => {
    // eslint-disable-next-line no-console
    console.error("FATAL:", err.message);
    process.exit(1);
  });
}

export { BEHAVIORS, RILEY_PICTURE, callMaya, sendTelegram };
