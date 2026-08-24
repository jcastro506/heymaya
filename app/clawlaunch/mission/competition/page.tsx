"use client";

/**
 * ⭐ THE COMPETITION — ads their rivals keep paying to run.
 *
 * This is the screen that proves the pitch. Everything else on Mission Control
 * reports on our own work; this reports on somebody else's money. An ad alive
 * for sixty days is one a company with a dashboard has decided, every morning
 * for two months, not to switch off — and that is the strongest evidence in the
 * product by a wide margin.
 *
 * ## ⚠️ The video URL has an expiry date
 *
 * Meta signs these and they die in about four days — measured, not assumed. The
 * server computes `playable` against request time rather than letting the
 * browser discover it, so a stale ad shows its poster and a link to Meta's own
 * library instead of a dead black frame.
 *
 * We deliberately do NOT rehost the video. That is a decision about someone
 * else's asset, and the poster answers the same question without making it.
 *
 * ## What this screen is not
 *
 * Not a workbench. §1 — the dashboard is connect and receipts. Clicking an ad
 * explains it; nothing here edits, schedules or publishes anything.
 */

import { useState } from "react";
import { useQuery } from "convex/react";
import * as Dialog from "@radix-ui/react-dialog";
import { api } from "@/convex/_generated/api";
import { Panel, Rise, Shell, Loading } from "../_components";

/** Plain-language names for the asset rung a rebuild would need. */
const REQUIRES_LABEL: Record<string, string> = {
  founder_footage: "needs you on camera",
  screen_recording: "needs a screen recording",
  product_screenshot: "screenshots are enough",
  generated_background: "stock or generated visuals",
  avatar: "needs a presenter",
};

type Ad = NonNullable<
  ReturnType<typeof useQuery<typeof api.maya.dashboard.myCompetition>>
>["ads"][number];

export default function CompetitionPage() {
  const data = useQuery(api.maya.dashboard.myCompetition, {});
  const [open, setOpen] = useState<Ad | null>(null);

  // ⚠️ Null AND undefined — undefined is loading, null is a query that resolved
  // to nothing. Guarding one and not the other crashes the page.
  if (!data) return <Loading />;
  if (!data.ok) {
    return (
      <Shell title="The competition">
        <p className="text-sm text-paper-faint">Sign in to see this.</p>
      </Shell>
    );
  }

  const watched = data.ads.filter((a) => a.watched).length;

  return (
    <Shell
      title="The competition"
      subtitle="Ads their rivals are still paying to run. The longer one has been live, the more somebody has bet that it works."
    >
      <div className="mc-grid">
        <Rise className="col-span-full">
          <Panel title="Who she's watching">
            {data.confirmed.length === 0 && data.unconfirmed.length === 0 ? (
              <p className="text-sm text-paper-faint">
                She hasn&apos;t worked out who you compete with yet. Tell her in
                Telegram and she&apos;ll start watching them.
              </p>
            ) : (
              <div className="mc-chips">
                {data.confirmed.map((c) => (
                  <span key={c} className="mc-chip">
                    {c}
                  </span>
                ))}
                {/**
                  * ⚠️ Unconfirmed names are marked, never blended in. She worked
                  * these out from who advertises against the same keywords — a
                  * good guess, and still a guess. Presenting it as settled is
                  * how a week gets built on the wrong company.
                  */}
                {data.unconfirmed.map((c) => (
                  <span key={c} className="mc-chip mc-chip-guess">
                    {c} · unconfirmed
                  </span>
                ))}
              </div>
            )}
            {data.unconfirmed.length > 0 ? (
              <p className="mc-learn-sub" style={{ marginBottom: 0 }}>
                She worked the unconfirmed ones out herself — tell her in
                Telegram if any are wrong
              </p>
            ) : null}
          </Panel>
        </Rise>

        <Rise i={1} className="col-span-full">
          <Panel title={`Their ads · ${data.ads.length} live, ${watched} watched`}>
            {data.ads.length === 0 ? (
              <p className="text-sm text-paper-faint">
                Nothing yet. She checks weekly, and anything running three weeks
                or more is worth copying.
              </p>
            ) : (
              <div className="mc-adgrid">
                {data.ads.map((ad) => (
                  <button
                    key={ad.id}
                    type="button"
                    onClick={() => setOpen(ad)}
                    className="mc-adcard"
                  >
                    <div className="mc-adcard-media">
                      {/**
                        * Poster only in the grid — autoplaying a wall of
                        * competitor videos is noise, and each one is a real
                        * download. The detail view plays it.
                        */}
                      {ad.posterUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- reason: remote fbcdn poster; next/image would need a domain allowlist per CDN shard
                        <img src={ad.posterUrl} alt="" loading="lazy" />
                      ) : (
                        <div className="mc-adcard-nomedia">no preview</div>
                      )}
                      <span className="mc-adcard-days">{ad.daysRunning}d</span>
                      {ad.playable ? (
                        <span className="mc-adcard-play">▶</span>
                      ) : null}
                    </div>
                    <div className="mc-adcard-who">{ad.advertiser}</div>
                    <div className="mc-adcard-hook">{ad.hook}</div>
                    {ad.variants > 1 ? (
                      <div className="mc-adcard-meta">
                        {ad.variants} versions running
                      </div>
                    ) : null}
                  </button>
                ))}
              </div>
            )}
          </Panel>
        </Rise>
      </div>

      <AdDetail ad={open} onClose={() => setOpen(null)} />
    </Shell>
  );
}

/**
 * The full read of one ad.
 *
 * Radix owns focus trapping, escape and scroll lock — the things a hand-rolled
 * modal gets wrong in ways that are an accessibility failure rather than a
 * cosmetic one.
 */
function AdDetail({ ad, onClose }: { ad: Ad | null; onClose: () => void }) {
  return (
    <Dialog.Root open={ad !== null} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="mc-dialog-overlay" />
        <Dialog.Content className="mc-dialog">
          {ad ? (
            <>
              <Dialog.Title className="mc-dialog-title">
                {ad.advertiser}
                <span className="mc-ad-days"> · {ad.daysRunning}d live</span>
              </Dialog.Title>
              <Dialog.Description className="mc-dialog-desc">
                {ad.hook}
              </Dialog.Description>

              {ad.playable ? (
                // eslint-disable-next-line jsx-a11y/media-has-caption -- reason: a competitor's ad; we have no caption track and inventing one would be fabrication
                <video
                  className="mc-dialog-video"
                  src={ad.videoUrl}
                  poster={ad.posterUrl || undefined}
                  controls
                  preload="metadata"
                />
              ) : (
                <div className="mc-dialog-stale">
                  {ad.posterUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- reason: remote fbcdn poster
                    <img src={ad.posterUrl} alt="" />
                  ) : null}
                  {/* Honest about WHY, rather than a broken player. */}
                  <p>
                    Meta&apos;s copy of this video has expired. It&apos;s still
                    live in their ad library.
                  </p>
                </div>
              )}

              <div className="mc-dialog-facts">
                {ad.device ? (
                  <div>
                    <span className="k">how it&apos;s made</span>
                    <span className="v">{ad.device}</span>
                  </div>
                ) : null}
                {ad.requires ? (
                  <div>
                    <span className="k">to rebuild</span>
                    <span className="v">
                      {REQUIRES_LABEL[ad.requires] ?? ad.requires}
                    </span>
                  </div>
                ) : null}
                {ad.lengthSec > 0 ? (
                  <div>
                    <span className="k">length</span>
                    <span className="v">{ad.lengthSec}s</span>
                  </div>
                ) : null}
                {ad.cta ? (
                  <div>
                    <span className="k">the ask</span>
                    <span className="v">{ad.cta}</span>
                  </div>
                ) : null}
              </div>

              {/* ⭐ The one structural thing worth stealing. §7.5.3 — the shape
                  travels between products, the claims never do. */}
              {ad.borrowable ? (
                <>
                  <div className="mc-learn-sub">What&apos;s worth stealing</div>
                  <p className="mc-ad-steal">{ad.borrowable}</p>
                </>
              ) : null}

              {ad.beats.length > 0 ? (
                <>
                  <div className="mc-learn-sub">How it unfolds</div>
                  <div className="mc-beats">
                    {ad.beats.map((b) => (
                      <div key={`${b.atSec}-${b.whatHappens}`} className="mc-beat">
                        <span className="t">{b.atSec}s</span>
                        <span>
                          {b.whatHappens}
                          {b.onScreen ? (
                            <em className="mc-beat-screen">{b.onScreen}</em>
                          ) : null}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}

              {ad.script ? (
                <>
                  <div className="mc-learn-sub">What they say</div>
                  <p className="mc-ad-hook">{ad.script}</p>
                </>
              ) : null}

              {!ad.watched ? (
                <p className="mc-learn-sub" style={{ marginBottom: 0 }}>
                  She hasn&apos;t watched this one yet — she watches the
                  strongest few each week
                </p>
              ) : null}

              <div className="mc-dialog-acts">
                <a
                  href={ad.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mc-btn no-underline"
                >
                  Open in Meta&apos;s ad library
                </a>
                <Dialog.Close className="mc-btn mc-btn-primary">
                  Close
                </Dialog.Close>
              </div>
            </>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
