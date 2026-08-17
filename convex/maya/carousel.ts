/**
 * ⭐ `make-carousel` (§7.5.1, Sprint 7) — brand-coherent slide sets.
 *
 * §3283's tool contract:
 *
 * > **Uses:** `search_media` first — never assume an asset exists · fixed
 * > layouts + brand kit · **Judgment:** which of the five layouts
 * > (title/screenshot/point/comparison/CTA) carries this angle · **Hard
 * > rules:** headlines composited as **real text**, never generated pixels ·
 * > **set-level critic** — reject the set, not slides · real screenshots only
 * > · **Output:** a coherent slide set.
 *
 * ## Why this is the cheap path, and why that matters
 *
 * Title, point and CTA slides never touch an image model at all — they are the
 * founder's words, set in their typeface, on their colours. §7.5.1's whole
 * argument is that **the layout system is ours either way**, so the expensive
 * rung is optional rather than load-bearing. A daily TikTok photo post costs
 * one cheap planning call and one cheap critic call.
 *
 * ## Where the coherence actually comes from
 *
 * Not from the critic. §7.5.1: *"Coherence by construction. The frame is
 * literally the same layout every time… Nothing can drift because nothing about
 * the frame is being re-decided."* Margins, type scale, palette and safe area
 * are fixed in `slides.ts` and no model touches them.
 *
 * So the thing that can still be incoherent is the **narrative** — five slides
 * that are individually fine and don't add up to one point. That is what the
 * set-level critic reads, and it is why the critic runs on the plan rather than
 * on the pixels: the pixels are already guaranteed.
 *
 * ⚠️ That is a deliberate deviation from §7.5.1's *"before delivery, one check
 * on the assembled set"*. Checking the plan first means a rejected set costs one
 * cheap call instead of a render and a stored asset per slide. A deterministic
 * check still runs after assembly, because "did every slide actually render"
 * is not a judgment call and should never be one.
 */

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { renderSlide, type SlideContent, type SlideLayout } from "./slides";
import { runGate, capToBuildable } from "./preSpendGate";
import { pickCard } from "./formats";
import type { BrandKit } from "./brandKit";

/** Plans the set. The headlines ARE the post's words, so this is the voice tier. */
export const PLAN_MODEL = "openai/gpt-5.6-luna-pro";

/** Reads the assembled set for one point. Cheap judge, per the model routing. */
export const CRITIC_MODEL = "google/gemini-3.1-flash-lite";

/**
 * §7.5.1's five, and no sixth.
 *
 * A closed set is the point — an open one is a design system the model
 * re-decides every time, which is the drift this replaces.
 */
export const LAYOUTS: SlideLayout[] = [
  "title",
  "screenshot",
  "point",
  "comparison",
  "cta",
];

/**
 * Slides per set.
 *
 * Floor of 3 because two slides is a picture with a caption. Ceiling of 6
 * because carousel completion falls off a cliff past it and every extra slide
 * is another chance to lose the thread.
 */
export const MIN_SLIDES = 3;
export const MAX_SLIDES = 6;

export interface PlannedSlide {
  layout: SlideLayout;
  content: SlideContent;
}

export interface RenderedSlide {
  index: number;
  layout: SlideLayout;
  headline: string;
  assetId: Id<"mediaAssets">;
  url: string;
  bytes: number;
}

export interface CarouselResult {
  ok: boolean;
  slides: RenderedSlide[];
  /** Plain language for the founder. Never mentions a model or a vendor. */
  detail: string;
  /** ⭐ Which proven shape this borrowed, if any. Written onto the placement. */
  formatCardId?: string;
  /** Why it stopped, when it did. Named, never silent. */
  failure?:
    | "no_idea"
    | "no_plan"
    | "house_rule"
    | "critic_rejected"
    | "render_unavailable"
    | "render_failed"
    /** ⭐ §7.5.7 stopped it before a penny was spent. */
    | "pre_spend_gate";
  criticWhy?: string;
}

/* -------------------------------------------------------------------------- */
/* Planning                                                                    */
/* -------------------------------------------------------------------------- */

export const PLAN_SYSTEM = `You are laying out a carousel for a founder's own social account.

You get an angle, the founder's product truth, and a list of REAL screenshots
that exist in their media library. You return the slide plan.

Return STRICT JSON, no prose:
{ "slides": [ { "layout": "title"|"screenshot"|"point"|"comparison"|"cta",
                "headline": string,
                "eyebrow"?: string,
                "body"?: string,
                "left"?: string, "right"?: string,
                "imageRef"?: number } ] }

The layouts:
- "title"      opens the set. The hook. Nothing else earns the first slide.
- "screenshot" frames one REAL screenshot. Set "imageRef" to its number in the
               list you were given. Never use this layout without one.
- "point"      a headline and a supporting line. The workhorse.
- "comparison" two sides — set "left" and "right". Use it when the angle IS a
               contrast, not to decorate one.
- "cta"        closes the set. One line. Where to go.

Rules:
- 3 to 6 slides. Every slide earns its place or is cut.
- The set makes ONE point. A slide that introduces a second point is the wrong
  slide.
- Headlines are short enough to read at a glance while scrolling. Long ones wrap
  and stop being headlines.
- Write the founder's words, not marketing copy. No exclamation marks, no
  "unlock", no "game-changer", no rhetorical questions as headlines.
- Only claim what the product truth supports. You may not invent a number, a
  customer, or a result.
- If no real screenshot fits, do not use the screenshot layout. A set with no
  screenshot is fine; a screenshot layout with nothing real in it is not.`;

/* -------------------------------------------------------------------------- */
/* The set-level critic                                                        */
/* -------------------------------------------------------------------------- */

export const CRITIC_SYSTEM = `You are checking whether a carousel reads as ONE thing.

You get the slides in order. Judge the set, never an individual slide.

Return STRICT JSON, no prose:
{ "coherent": boolean, "why": string }

Reject the set when:
- the slides are about two different things
- slide 1 promises something the rest never delivers
- the order could be shuffled without loss — that means there's no argument
- the last slide doesn't land anywhere
- it reads like it was assembled from a template rather than written

Accept a set that makes one point and gets somewhere. Do not reject for tone,
for length, or because you would have written it differently. "why" is one
sentence, addressed to the person who made it.`;

/* -------------------------------------------------------------------------- */

/**
 * ⭐ Idea → a stored, postable slide set.
 *
 * Requires an `ideaId` rather than free text. §6's rule is that every post
 * traces back to something a real person said, and an asset built from a
 * prompt someone typed has no evidence behind it — `drafts.ts` already refuses
 * a post with no idea, and it would be strange for the picture to have a weaker
 * standard than the caption.
 */
export const makeCarousel = internalAction({
  args: {
    customerId: v.id("customers"),
    ideaId: v.id("ideas"),
    /** Optional steer from the founder — "lead with the pricing bit". */
    steer: v.optional(v.string()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<CarouselResult> => {
    const idea = await ctx.runQuery(internal.maya.ideas.byId, {
      ideaId: args.ideaId,
    });
    if (!idea || idea.customerId !== args.customerId) {
      return {
        ok: false,
        slides: [],
        failure: "no_idea",
        detail: "I couldn't find that idea.",
      };
    }

    /**
     * `search_media` first — §3435's first hard rule.
     *
     * Screenshots are filtered to the ones the classifier called real product
     * imagery. §2.7 forbids a fabricated UI, and an illustration scraped off a
     * marketing page is exactly that when it's presented as the product.
     */
    const assets = await ctx.runQuery(internal.maya.media.forCustomer, {
      customerId: args.customerId,
    });
    const screenshots = assets.filter(
      (a: Doc<"mediaAssets">) =>
        a.publicUrl &&
        (a.classifiedAs === "product_screenshot" || a.kind === "screenshot"),
    );

    /**
     * ⭐ §7.5.7's pre-spend gate, BEFORE any model call or render.
     *
     * ⚠️ `runGate` was written with tests and had NO CALLER — so the gate whose
     * entire purpose is "an approved idea can never fail on budget or assets"
     * has never run, and `makeCarousel` spent render credits with no ceiling
     * check of any kind.
     *
     * Only the four checks whose inputs are genuinely available here are fed.
     * The verdict names the rest in `notEvaluated` rather than letting them
     * silently pass — an invented input makes a gate look active while checking
     * nothing, which is worse than not calling it at all.
     */
    const spend = await ctx.runQuery(internal.maya.spendCeiling.spendToday, {
      customerId: args.customerId,
    });
    const plan = await ctx.runQuery(internal.maya.planFeatures.planFeatures, {
      customerId: args.customerId,
    });

    const gate = runGate({
      rung: "carousel",
      // `throttled` degrades rather than blocks — §2.10, budgets never
      // booleans, and the founder gets a static instead of silence.
      budgetMode: spend.state === "throttled" ? "graceful_degrade" : "full",
      // The fleet pool is the same ceiling at this tier; a customer-level
      // throttle already implies it.
      poolAboveReserve: spend.state !== "throttled",
      /**
       * ⚠️ `videosPerMonth: 0` is a real tier, not a broken one. A plan with no
       * video allowance still gets carousels.
       *
       * ⭐ Capped by what can actually be BUILT, not only by what was bought.
       * `mvp` grants 4 videos a month, so this computed to `avatar` — a video
       * rung with no implementation anywhere in `convex/maya`. The gate said
       * yes to work nothing could do, which turns a budget into a promise the
       * founder never gets. See `MAX_BUILDABLE_RUNG`.
       */
      tierMaxRung: capToBuildable(
        plan.videosPerMonth > 0 ? "avatar" : "carousel",
      ),
      assetsNamed: 1,
      assetsResolved: screenshots.length > 0 ? 1 : 0,
    });

    if (!gate.proceed) {
      return {
        ok: false,
        slides: [],
        // Her words, already plain language — relayed unchanged (§11).
        detail: gate.detail,
        failure: "pre_spend_gate",
      };
    }

    const truth = await ctx.runQuery(internal.maya.productTruth.forCustomer, {
      customerId: args.customerId,
    });
    const kit: BrandKit | null = await ctx.runQuery(
      internal.maya.brandKit.brandKitFor,
      { customerId: args.customerId },
    );

    /**
     * ⭐ The founder's own words, as few-shot grounding.
     *
     * ⚠️ Without these the planner writes marketing copy. Measured on the first
     * live run against the real account: it opened with *"The unexpected
     * ingredient is an AI hire"* and structured the middle as STEP 1 / STEP 2 /
     * STEP 3. Both are exactly §7.5.2's tells, and the second is the
     * template feel the set critic exists to catch.
     *
     * Product truth says what is TRUE. It says nothing about how this person
     * writes, and a planner given only facts defaults to the register of the
     * marketing pages it was trained on.
     */
    const excerpts = await ctx.runQuery(
      internal.maya.voiceCorpus.voiceExcerptsFor,
      { customerId: args.customerId },
    );

    /**
     * ⭐ Borrow a shape that demonstrably worked in this niche.
     *
     * §18's *"format card → brief"* row: *"without it she picks a template
     * because it looks fun rather than because three top posts in this niche
     * were that shape."*
     *
     * ⚠️ The card supplies the SHAPE, never the content. §9's rule for
     * `ads_clone` applies just as hard here: *"copy the structure, never the
     * content"* — a set that reproduces someone else's claims with this
     * founder's logo on it is a defect, not a feature. That's why `reusableAs`
     * is the only field that reaches the prompt: it is written to be
     * product-agnostic, and the hook line and metrics deliberately are not
     * passed.
     */
    const library = await ctx.runQuery(internal.maya.formats.formatCardsFor, {
      customerId: args.customerId,
      now: args.now,
    });
    const card = pickCard(library.cards, { channel: "tiktok" });

    const { callModel } = await import("./llm");
    const apiKey = process.env.OPENROUTER_API_KEY ?? "";

    const screenshotList = screenshots
      .map(
        (s: Doc<"mediaAssets">, i: number) =>
          `${i}. ${s.caption ?? s.classifiedAs ?? "screenshot"}`,
      )
      .join("\n");

    const planPrompt = [
      `ANGLE: ${idea.angle}`,
      truth ? `PRODUCT TRUTH:\n${describeTruth(truth)}` : "",
      screenshots.length > 0
        ? `REAL SCREENSHOTS AVAILABLE:\n${screenshotList}`
        : "REAL SCREENSHOTS AVAILABLE: none — do not use the screenshot layout.",
      excerpts.length > 0
        ? `HOW THIS FOUNDER ACTUALLY WRITES — match this register, not a marketing page:\n${excerpts
            .slice(0, 8)
            .map((e: string) => `- ${e}`)
            .join("\n")}`
        : "",
      card
        ? `A SHAPE THAT WORKED IN THIS NICHE — follow the structure, never the content:\n${card.reusableAs}`
        : "",
      args.steer ? `THE FOUNDER ASKED: ${args.steer}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    /**
     * ⭐ Plan, check the house rules, and fix it once if it broke one.
     *
     * ⚠️ The first version returned *"I had a set ready and it broke something
     * you told me… Redoing it."* and then redid nothing. A message that
     * promises an action the code doesn't take is the same defect as a
     * contract nothing enforces — it just fails in the founder's inbox instead
     * of in a row.
     *
     * So the retry is real, and it is ONE. The second attempt is told exactly
     * which sentence it broke, which is the information that makes a retry
     * different from a re-roll. If it breaks the rule twice, that is worth
     * saying out loud rather than looping — the founder can then tell whether
     * their rule is being misread or the angle simply can't be written without
     * breaking it.
     */
    let planned: PlannedSlide[] = [];
    let brokenRule: string | undefined;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const messages = [
        { role: "system" as const, content: PLAN_SYSTEM },
        { role: "user" as const, content: planPrompt },
      ];
      if (brokenRule) {
        messages.push({
          role: "user" as const,
          content:
            `That set broke a rule the founder set: "${brokenRule}"\n\n` +
            `Write it again without breaking it. Do not work around the rule ` +
            `with a synonym — say what the thing actually does instead.`,
        });
      }

      try {
        const completion = await callModel(ctx, {
          customerId: args.customerId,
          purpose: "carousel_plan",
          apiKey,
          model: PLAN_MODEL,
          temperature: 0.7,
          maxTokens: 1200,
          messages,
        });
        // ⚠️ The union's failure arm carries a reason, and dropping it is how a
        // vendor outage turns into "she just didn't make anything today".
        if (!completion.ok) {
          console.error(`[carousel] plan call failed: ${completion.reason}`);
          planned = [];
        } else {
          planned = parsePlan(completion.content, screenshots);
        }
      } catch (error) {
        console.error(
          `[carousel] plan failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        planned = [];
      }

      if (planned.length < MIN_SLIDES) break;

      const house = await ctx.runAction(
        internal.maya.directiveGate.checkDirectives,
        { customerId: args.customerId, text: slideTextOf(planned) },
      );
      if (house.ok) {
        brokenRule = undefined;
        break;
      }
      brokenRule = house.rule ?? "a rule you set";
      console.warn(
        `[carousel] attempt ${attempt + 1} broke a house rule: ${brokenRule}`,
      );
    }

    if (planned.length < MIN_SLIDES) {
      return {
        ok: false,
        slides: [],
        failure: "no_plan",
        detail: "I couldn't get a set out of this angle that held together.",
      };
    }

    if (brokenRule) {
      return {
        ok: false,
        slides: [],
        failure: "house_rule",
        detail: `I tried this angle twice and both times it broke something you told me: "${brokenRule}". I'll leave it — either the angle needs to change or that rule does.`,
      };
    }

    /**
     * The critic, on the plan.
     *
     * ⚠️ It rejects the SET. There is deliberately no path here that drops a
     * slide and keeps going — §7.5.1 is explicit, and a set that survives by
     * losing its weakest slide is usually a set that never had an argument.
     */
    const critic = await runCritic(ctx, {
      customerId: args.customerId,
      apiKey,
      planned,
    });
    if (!critic.coherent) {
      return {
        ok: false,
        slides: [],
        failure: "critic_rejected",
        criticWhy: critic.why,
        detail: `I made a set for this and it didn't hold together — ${critic.why} Want me to try a different angle on it?`,
      };
    }

    /* ---------------------------------------------------------------------- */

    /**
     * ⭐ The generated rung, and ONLY when there is nothing real to show.
     *
     * §7.5.1 keeps the cheap path as the default: real text on brand colours
     * costs nothing, and that is what makes a daily placement free. So this
     * fires on one condition — the library had no usable screenshot, meaning
     * the set would otherwise be entirely type.
     *
     * ⚠️ Self-limiting by design. One image per set (~$0.039), on the title
     * slide, which is the one that decides whether anyone swipes. A founder
     * who sends real screenshots never pays for this at all, and the spend
     * falls away by itself the moment their library improves rather than
     * needing a flag someone remembers to turn off.
     *
     * §7.5.3's ordering is preserved: a generated background is the LAST
     * resort, never a substitute for a screenshot that exists.
     */
    if (screenshots.length === 0 && planned[0]?.layout === "title") {
      const background = await ctx.runAction(
        internal.maya.imagery.backgroundFor,
        {
          customerId: args.customerId,
          // The headline is the brief. It already describes the slide's subject,
          // and inventing a separate art direction would be a second thing that
          // can disagree with the words.
          brief: planned[0].content.headline,
          now: args.now,
        },
      );
      if (background.ok && background.url) {
        planned[0].content.imageUrl = background.url;
      } else {
        // Not fatal — the set still works as type. Named so a repeated failure
        // is visible rather than looking like a stylistic choice.
        console.warn(
          `[carousel] no background: ${background.reason ?? "unknown"}`,
        );
      }
    }

    const rendered = await renderAndStore(ctx, {
      customerId: args.customerId,
      planned,
      kit,
      now: args.now,
    });
    if ("failure" in rendered) {
      return {
        ok: false,
        slides: [],
        failure: rendered.failure,
        detail: rendered.detail,
      };
    }

    /**
     * The deterministic half of the check.
     *
     * "Did every slide render" is not a judgment and must not be one. A
     * four-slide set delivered as three is a broken set, and it would read as a
     * success everywhere else — the count is the only thing that catches it.
     */
    if (rendered.slides.length !== planned.length) {
      return {
        ok: false,
        slides: rendered.slides,
        failure: "render_failed",
        detail: `I got ${rendered.slides.length} of ${planned.length} slides made and stopped rather than post a set with a hole in it.`,
      };
    }

    return {
      ok: true,
      slides: rendered.slides,
      formatCardId: card?.cardId,
      detail: `${rendered.slides.length} slides, in your colours${
        screenshots.length > 0
          ? ""
          : " — no real screenshots on file yet, so this set is all type"
      }.`,
    };
  },
});

/* -------------------------------------------------------------------------- */

async function runCritic(
  ctx: ActionCtx,
  input: {
    customerId: Id<"customers">;
    apiKey: string;
    planned: PlannedSlide[];
  },
): Promise<{ coherent: boolean; why: string }> {
  const { callModel } = await import("./llm");
  const summary = input.planned
    .map((s, i) => {
      const bits = [`${i + 1}. [${s.layout}] ${s.content.headline}`];
      if (s.content.body) bits.push(`   ${s.content.body}`);
      if (s.content.left || s.content.right) {
        bits.push(`   ${s.content.left ?? ""} | ${s.content.right ?? ""}`);
      }
      return bits.join("\n");
    })
    .join("\n");

  try {
    const completion = await callModel(ctx, {
      customerId: input.customerId,
      purpose: "carousel_critic",
      apiKey: input.apiKey,
      model: CRITIC_MODEL,
      temperature: 0,
      maxTokens: 300,
      messages: [
        { role: "system", content: CRITIC_SYSTEM },
        { role: "user", content: summary },
      ],
    });
    if (!completion.ok) throw new Error(completion.reason);
    const parsed = JSON.parse(stripFence(completion.content)) as {
      coherent?: boolean;
      why?: string;
    };
    return {
      coherent: parsed.coherent !== false,
      why: typeof parsed.why === "string" ? parsed.why : "",
    };
  } catch (error) {
    /**
     * ⚠️ Fails OPEN, and that is the right call here.
     *
     * The critic is a quality gate, not a safety gate — the safety gates
     * (`publishDecision`, the iron rule, the plain-language guard) are
     * elsewhere and fail closed. A vendor blip should cost a check, never the
     * day's post. §12: honest silence beats fake activity, but a missing
     * critic is not a reason to ship nothing.
     */
    console.error(
      `[carousel] critic unavailable, passing set through: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return { coherent: true, why: "" };
  }
}

/* -------------------------------------------------------------------------- */

async function renderAndStore(
  ctx: ActionCtx,
  input: {
    customerId: Id<"customers">;
    planned: PlannedSlide[];
    kit: BrandKit | null;
    now?: number;
  },
): Promise<
  | { slides: RenderedSlide[] }
  | { failure: "render_unavailable" | "render_failed"; detail: string }
> {
  const base = process.env.RENDER_BASE_URL ?? process.env.APP_URL ?? "";
  const secret = process.env.RENDER_SHARED_SECRET ?? "";
  if (!base || !secret) {
    // Principle 5, and specific about which half is missing — "rendering is
    // not set up" sends someone looking in the wrong place.
    console.error(
      `[carousel] cannot render: ${!base ? "no RENDER_BASE_URL/APP_URL" : ""}${
        !base && !secret ? " and " : ""
      }${!secret ? "no RENDER_SHARED_SECRET" : ""}`,
    );
    return {
      failure: "render_unavailable",
      detail: "I can't make images right now — that's on my side, not yours.",
    };
  }

  const fontUrls = input.kit?.fontUrls ?? [];
  const slides: RenderedSlide[] = [];

  for (const [i, slide] of input.planned.entries()) {
    const svg = renderSlide({
      layout: slide.layout,
      content: slide.content,
      kit: input.kit,
      index: i + 1,
      total: input.planned.length,
    });

    let png: ArrayBuffer;
    try {
      const res = await fetch(`${base.replace(/\/$/, "")}/api/render/slide`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ svg, fontUrls: fontUrls.filter(Boolean) }),
      });

      /**
       * ⚠️ Check the content type, not just `res.ok`.
       *
       * A Vercel preview deployment behind deployment protection answers a
       * 302 to an SSO page, and following it yields **HTML with a 200**. Stored
       * blindly that becomes a `.png` full of markup which fails on the
       * platform, hours later, as "invalid image" — the failure lands as far
       * as possible from its cause. `media.storeRendered` checks the magic
       * bytes as well; this is the check that can say *why*.
       */
      const contentType = res.headers.get("content-type") ?? "";
      if (!res.ok || !contentType.startsWith("image/")) {
        /**
         * ⚠️ Say which of the three it is. They need different fixes and they
         * are indistinguishable from the response body alone:
         *   404 → the route isn't on that host (wrong branch deployed)
         *   401 → the shared secret is missing or doesn't match
         *   302/HTML-200 → deployment protection is answering instead
         */
        const diagnosis =
          res.status === 404
            ? " — the render route isn't deployed at that host; check RENDER_BASE_URL points at a deploy that has it"
            : res.status === 401 || res.status === 403
              ? " — RENDER_SHARED_SECRET is missing or doesn't match the host's"
              : contentType.includes("text/html")
                ? " — that's a web page, not an image; the host is probably behind deployment protection"
                : "";
        console.error(
          `[carousel] render slide ${i + 1}: HTTP ${res.status}, content-type "${contentType}"${diagnosis}`,
        );
        return {
          failure: "render_failed",
          detail: "I couldn't get the images made. Nothing's gone out.",
        };
      }
      png = await res.arrayBuffer();
    } catch (error) {
      console.error(
        `[carousel] render slide ${i + 1} threw: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {
        failure: "render_failed",
        detail: "I couldn't get the images made. Nothing's gone out.",
      };
    }

    const stored = await ctx.runAction(internal.maya.media.storeRendered, {
      customerId: input.customerId,
      pngBase64: toBase64(png),
      caption: `slide ${i + 1}/${input.planned.length} — ${slide.content.headline}`,
      now: input.now,
    });
    if (!stored.ok) {
      console.error(`[carousel] store slide ${i + 1}: ${stored.error}`);
      return {
        failure: "render_failed",
        detail: "I couldn't get the images made. Nothing's gone out.",
      };
    }

    slides.push({
      index: i + 1,
      layout: slide.layout,
      headline: slide.content.headline,
      assetId: stored.assetId,
      url: stored.url,
      bytes: stored.bytes,
    });
  }

  return { slides };
}

/* -------------------------------------------------------------------------- */
/* Parsing                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Every word that will be rendered into the pictures, as one string.
 *
 * ⚠️ This is what the house-rule gate reads. `publish.ts` checks the caption
 * and has never checked this — so a founder who said "never call it an AI" got
 * that honoured in the caption and broken on slide one, permanently, in a PNG.
 */
export function slideTextOf(planned: PlannedSlide[]): string {
  return planned
    .map((s) =>
      [
        s.content.eyebrow,
        s.content.headline,
        s.content.body,
        s.content.left,
        s.content.right,
      ]
        .filter(Boolean)
        .join(" "),
    )
    .join("\n");
}

export function stripFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "")
    .trim();
}

/**
 * Turn the model's JSON into slides we will actually render.
 *
 * Exported and pure so the constraints are testable without a model: the five
 * layouts, the slide count, and — the one that matters — that a `screenshot`
 * layout without a real image becomes a `point` rather than an empty frame.
 */
export function parsePlan(
  raw: string,
  screenshots: Array<{ publicUrl?: string }>,
): PlannedSlide[] {
  let parsed: { slides?: unknown };
  try {
    parsed = JSON.parse(stripFence(raw)) as { slides?: unknown };
  } catch {
    return [];
  }
  if (!Array.isArray(parsed.slides)) return [];

  const out: PlannedSlide[] = [];
  for (const entry of parsed.slides.slice(0, MAX_SLIDES)) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;

    const headline = typeof e.headline === "string" ? e.headline.trim() : "";
    if (!headline) continue;

    let layout: SlideLayout = LAYOUTS.includes(e.layout as SlideLayout)
      ? (e.layout as SlideLayout)
      : "point";

    const content: SlideContent = { headline };
    if (typeof e.eyebrow === "string" && e.eyebrow.trim()) {
      content.eyebrow = e.eyebrow.trim();
    }
    if (typeof e.body === "string" && e.body.trim())
      content.body = e.body.trim();
    if (typeof e.left === "string") content.left = e.left.trim();
    if (typeof e.right === "string") content.right = e.right.trim();

    if (layout === "screenshot") {
      const ref = typeof e.imageRef === "number" ? e.imageRef : -1;
      const url = screenshots[ref]?.publicUrl;
      if (url) {
        content.imageUrl = url;
      } else {
        /**
         * ⚠️ Demoted, never rendered empty.
         *
         * §2.7 is "grounded or silent" — a screenshot frame with nothing in it
         * is a slide that promises a product shot and shows a rectangle. The
         * words still work as a point, so the set survives.
         */
        layout = "point";
      }
    }

    // `comparison` without both sides is a headline with a stray divider.
    if (layout === "comparison" && !(content.left && content.right)) {
      layout = "point";
    }

    out.push({ layout, content });
  }

  return out;
}

/**
 * The product truth, as the planner needs to see it.
 *
 * ⚠️ `founderSays` goes LAST and is labelled as outranking the rest. The record
 * itself says why: a scrape can go stale while the founder's own words cannot,
 * so a planner that weighs a marketing page equally with a correction will
 * quietly re-introduce the thing that was corrected.
 */
export function describeTruth(truth: {
  name?: string;
  whatItIs?: string;
  whoItsFor?: string;
  whatsDifferent?: string;
  founderSays?: string[];
}): string {
  const lines = [
    truth.name ? `Product: ${truth.name}` : "",
    truth.whatItIs ? `What it is: ${truth.whatItIs}` : "",
    truth.whoItsFor ? `Who it's for: ${truth.whoItsFor}` : "",
    truth.whatsDifferent ? `What's different: ${truth.whatsDifferent}` : "",
  ].filter(Boolean);

  if (truth.founderSays && truth.founderSays.length > 0) {
    lines.push(
      `The founder's own words (these outrank everything above):\n` +
        truth.founderSays.map((s) => `- ${s}`).join("\n"),
    );
  }
  return lines.join("\n");
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  // Chunked: `String.fromCharCode(...bytes)` blows the argument limit somewhere
  // around 100 KB, and a slide is bigger than that.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
