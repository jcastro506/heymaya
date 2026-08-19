"use client";

/**
 * ⭐ Videos — the screen a UGC product exists to have.
 *
 * Mission Control could show drafts, results, activity and research, and not
 * the one artifact the founder is paying for. See docs/MISSION_CONTROL_UGC.md.
 *
 * ## What it shows that nothing else can
 *
 * Every video carries **how it was built** and **what it cost**. "This one
 * underperformed" is not actionable. "This one underperformed and it used a
 * generated presenter, because the library was empty" names the fix — and the
 * fix is the founder's to make, which is exactly the kind of thing this
 * dashboard is for.
 *
 * ## What it deliberately does not have
 *
 * No editor, no re-render button, no regenerate. §2.1: connect + receipts,
 * never a workbench. If a video is wrong, that is a sentence in the messenger,
 * not a control here.
 */

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  Card,
  Chip,
  Empty,
  Loading,
  NeedsOnboarding,
  Rise,
  Section,
  Shell,
  channelLabel,
  monoDate,
} from "../_components";

/** The §7.5.3 ladder, in the founder's words rather than ours. */
const RUNG_LABEL: Record<string, string> = {
  founder_footage: "your footage",
  screen_recording: "a screen recording",
  product_screenshot: "your screenshots",
  generated_background: "generated backgrounds",
  avatar: "a generated presenter",
};

export default function VideosPage() {
  const data = useQuery(api.maya.dashboard.myVideos, {});

  if (data === undefined) return <Loading />;
  /**
   * ⚠️ `!data` as well as `!data.ok`. A query can resolve to null — signed out,
   * no account, or a transport that returned nothing — and reading `.ok` off it
   * throws, blanking the whole screen. Neither case is a Videos problem and
   * both already have a designed screen.
   */
  if (!data || !data.ok) return <NeedsOnboarding />;

  const videos = data.videos ?? [];

  return (
    <Shell
      title="Videos"
      subtitle="Everything she's made, what it was built from, and where it went."
    >
      {videos.length === 0 ? (
        <Rise>
          {/**
           * ⚠️ Points at the messenger, not at a button. There is no "make a
           * video" control here by design, and an empty panel with no next step
           * confirms the fear that nothing is happening.
           */}
          <Empty
            title="Nothing yet."
            body="She'll make the first one once she's picked an idea. Send her a screen recording in chat and it'll be built from that instead of a stock presenter."
          />
        </Rise>
      ) : (
        <Section title="Made" count={videos.length}>
          {videos.map((v) => (
            <Rise key={v.assetId}>
              <Card>
                <div className="flex flex-col gap-3">
                  {v.url ? (
                    // eslint-disable-next-line jsx-a11y/media-has-caption -- reason: generated product video, no dialogue track to caption
                    <video
                      src={v.url}
                      controls
                      preload="metadata"
                      className="w-full max-w-[280px] rounded-lg bg-black"
                    />
                  ) : null}

                  <div className="flex flex-wrap items-center gap-2">
                    {/**
                     * ⚠️ `null` renders as "not recorded", never as "avatar".
                     * A video made before we kept provenance has an UNKNOWN
                     * rung, and defaulting it would invent a fact about the
                     * founder's own content (§16.4).
                     */}
                    <Chip>
                      {v.builtFrom
                        ? `built from ${RUNG_LABEL[v.builtFrom] ?? v.builtFrom}`
                        : "not recorded"}
                    </Chip>
                    {v.usedAvatar === true ? (
                      <Chip>used a presenter</Chip>
                    ) : null}
                    {v.credits !== null ? (
                      <span className="mc-when mc-num">{v.credits} credits</span>
                    ) : null}
                    <span className="mc-when mc-num">{monoDate(v.madeAt)}</span>
                  </div>

                  {v.placements.length === 0 ? (
                    <p className="mc-when">Not posted yet.</p>
                  ) : (
                    <ul className="mc-tick">
                      {v.placements.map((p) => (
                        <li key={`${p.channel}-${p.publishedAt}`}>
                          <span className="t">{channelLabel(p.channel)}</span>
                          <span className="s">
                            {/**
                             * ⚠️ "no numbers yet" rather than 0. A placement
                             * whose metrics have never been fetched is not a
                             * post nobody watched — `myVideos` returns null for
                             * exactly this distinction.
                             */}
                            {p.views === null
                              ? "no numbers yet"
                              : `${p.views.toLocaleString()} views`}
                            {p.url ? (
                              <>
                                {" · "}
                                <a
                                  href={p.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="no-underline hover:underline"
                                >
                                  see it
                                </a>
                              </>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </Card>
            </Rise>
          ))}
        </Section>
      )}
    </Shell>
  );
}
