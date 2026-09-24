"use client";

import { useState } from "react";

type Platform = "instagram" | "tiktok";
type Result = "quiet" | "strong";

// Illustrative examples, never customer results. Keep TikTok's examples limited
// to counters; connected watch time and retention are Instagram Reels only.
const examples = {
  instagram: {
    quiet: {
      title: "The little London vlog",
      comparison: "People reached",
      value: 1240,
      normal: 3600,
      metrics: [
        {
          label: "People reached",
          value: "1,240",
          note: "0.34× your usual reach",
        },
        { label: "Average watch", value: "71%", note: "14.2s of a 20s Reel" },
        {
          label: "Follows from this Reel",
          value: "+9",
          note: "Reported by Instagram",
        },
      ],
      message:
        "smaller audience, but they watched 71% on average. i wouldn’t scrap the idea. let’s try a different opening on the next one and see what changes.",
      takeaway: "A quieter post isn’t the whole story.",
    },
    strong: {
      title: "The honest little update",
      comparison: "People reached",
      value: 9000,
      normal: 3600,
      metrics: [
        {
          label: "People reached",
          value: "9,000",
          note: "2.5× your usual reach",
        },
        { label: "Average watch", value: "76%", note: "15.2s of a 20s Reel" },
        {
          label: "Follows from this Reel",
          value: "+42",
          note: "Reported by Instagram",
        },
      ],
      message:
        "2.5× your usual reach, and people watched most of it. that honest opening is worth another go. same shape, new story. let’s see if it holds up twice.",
      takeaway: "Keep the good part. Make it yours again.",
    },
  },
  tiktok: {
    quiet: {
      title: "The little London vlog",
      comparison: "Video views",
      value: 1240,
      normal: 3600,
      metrics: [
        {
          label: "Video views",
          value: "1,240",
          note: "0.34× your usual views",
        },
        { label: "Likes", value: "86", note: "Reported by TikTok" },
        { label: "Shares", value: "12", note: "Reported by TikTok" },
      ],
      message:
        "this one’s below your usual views. that alone doesn’t tell me where people dropped off. send me the watch-time screenshot from TikTok Studio and we’ll look at it together.",
      takeaway: "An honest answer beats a confident guess.",
    },
    strong: {
      title: "The honest little update",
      comparison: "Video views",
      value: 9000,
      normal: 3600,
      metrics: [
        { label: "Video views", value: "9,000", note: "2.5× your usual views" },
        { label: "Likes", value: "640", note: "Reported by TikTok" },
        { label: "Shares", value: "85", note: "Reported by TikTok" },
      ],
      message:
        "2.5× your usual views, plus 85 shares. that’s worth a follow-up. i’d try another honest update before changing everything about your content.",
      takeaway: "A reason to try it again. Not a viral promise.",
    },
  },
} satisfies Record<
  Platform,
  Record<
    Result,
    {
      title: string;
      comparison: string;
      value: number;
      normal: number;
      metrics: { label: string; value: string; note: string }[];
      message: string;
      takeaway: string;
    }
  >
>;

export default function PerformancePreview() {
  const [platform, setPlatform] = useState<Platform>("instagram");
  const [result, setResult] = useState<Result>("quiet");
  const example = examples[platform][result];
  const maximum = Math.max(example.value, example.normal);

  return (
    <section
      id="your-numbers"
      className="maya-performance container"
      aria-labelledby="numbers-title"
    >
      <span className="chapter-divider" aria-hidden="true" />
      <div className="performance-intro">
        <div>
          <span className="maya-eyebrow">THE PART AFTER YOU HIT POST</span>
          <h2 id="numbers-title">
            She gets your vibe.
            <br />
            <span>And your numbers.</span>
          </h2>
        </div>
        <p>
          Connect your accounts and give Maya the fuller picture. Who saw it,
          what held their attention, and what’s worth trying next. In words you
          can actually use.
        </p>
      </div>

      <div className="performance-studio">
        <div className="performance-toolbar">
          <div
            className="performance-platforms"
            role="group"
            aria-label="Choose an example platform"
          >
            <button
              type="button"
              aria-pressed={platform === "instagram"}
              onClick={() => setPlatform("instagram")}
            >
              <span className="instagram-symbol" aria-hidden="true" />
              Instagram
            </button>
            <button
              type="button"
              aria-pressed={platform === "tiktok"}
              onClick={() => setPlatform("tiktok")}
            >
              <span className="platform-symbol" aria-hidden="true">
                ♪
              </span>
              TikTok
            </button>
          </div>
          <span className="performance-example-label">
            <span /> EXAMPLE REPORT · NOT LIVE DATA
          </span>
        </div>

        <div className="performance-layout">
          <div className="performance-report">
            <div className="performance-report-heading">
              <span>YOUR POST, IN PERSPECTIVE</span>
              <span aria-hidden="true">↗</span>
            </div>
            <h3>{example.title}</h3>
            <div
              className="performance-scenarios"
              role="group"
              aria-label="Choose an example result"
            >
              <button
                type="button"
                aria-pressed={result === "quiet"}
                onClick={() => setResult("quiet")}
              >
                A quieter post
              </button>
              <button
                type="button"
                aria-pressed={result === "strong"}
                onClick={() => setResult("strong")}
              >
                A stronger post
              </button>
            </div>
            <div className="performance-metrics">
              {example.metrics.map((metric) => (
                <div key={metric.label}>
                  <span>{metric.label}</span>
                  <strong>{metric.value}</strong>
                  <small>{metric.note}</small>
                </div>
              ))}
            </div>
            <div className="performance-comparison">
              <span>
                {example.comparison}{" "}
                <small>Compared with your own baseline</small>
              </span>
              <div className="performance-bar-row">
                <span>This post</span>
                <div>
                  <i style={{ width: `${(example.value / maximum) * 100}%` }} />
                </div>
                <b>{example.value.toLocaleString("en-US")}</b>
              </div>
              <div className="performance-bar-row baseline">
                <span>Your usual</span>
                <div>
                  <i
                    style={{ width: `${(example.normal / maximum) * 100}%` }}
                  />
                </div>
                <b>{example.normal.toLocaleString("en-US")}</b>
              </div>
            </div>
          </div>

          <div
            className="performance-reading"
            aria-live="polite"
            aria-atomic="true"
          >
            <span className="reading-eyebrow">WHAT MAYA MAKES OF IT</span>
            <div className="reading-person">
              <span aria-hidden="true">✳</span>
              <div>
                <b>Maya</b>
                <small>Your content person, connecting the dots.</small>
              </div>
            </div>
            <p className="reading-message">{example.message}</p>
            <span className="reading-takeaway">{example.takeaway}</span>
            <div className="reading-detail">
              <span aria-hidden="true">
                {platform === "instagram" ? "◷" : "▧"}
              </span>
              <p>
                {platform === "instagram"
                  ? "Reels watch time adds context to reach. Available metrics depend on your account and the post."
                  : "TikTok shares views, likes, comments, and shares. For watch time, send Maya a screenshot from TikTok Studio."}
              </p>
            </div>
          </div>
        </div>
        <div className="performance-access">
          <span>Connected insights open on your paid plan.</span>
          <span>Instagram Creator or Business · TikTok</span>
        </div>
      </div>

      <div className="performance-benefits">
        <div>
          <span aria-hidden="true">↗</span>
          <h3>Your own kind of progress.</h3>
          <p>
            Compare posts with your usual performance. Follow your audience
            growth as the weeks add up.
          </p>
        </div>
        <div>
          <span aria-hidden="true">✳</span>
          <h3>A next step, not a spreadsheet.</h3>
          <p>
            Bring what worked into your next idea, your next filming block, and
            your Sunday review.
          </p>
        </div>
        <div>
          <span aria-hidden="true">♡</span>
          <h3>She says what she can see.</h3>
          <p>
            Missing numbers stay missing. If a read is out of date, she tells
            you. You can always send a screenshot.
          </p>
        </div>
      </div>
    </section>
  );
}
