/**
 * K1: a creator's media kit, the link they paste into a pitch or a brand's form. One page, read in
 * 30–60 seconds: who they are, their numbers per platform, who watches (only with their yes), their
 * best recent posts, what they do, and how to reach them. A per-brand link leads with the posts
 * picked for that brand and one idea for them. Every number is dated. An unknown, revoked or closed
 * link is a 404. Never rates, preferences, excluded brands or who they tag.
 */
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { readPublicKit, recordKitOpen } from "@/lib/publicKit";
import { PrintButton } from "./PrintButton";
import "./kit.css";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const kit = await readPublicKit(slug);
  return { title: kit ? `@${kit.name} · media kit` : "Media kit", robots: { index: false, follow: false } };
}

const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M` : n >= 10_000 ? `${Math.round(n / 1_000)}K` : n >= 1_000 ? `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K` : String(Math.round(n)));
const pct = (x: number) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;
const PLATFORM: Record<string, string> = { tiktok: "TikTok", instagram: "Instagram" };

export default async function MediaKit({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const kit = await readPublicKit(slug);
  if (!kit) notFound();
  if (kit.forBrand) {
    const ua = (await headers()).get("user-agent");
    after(() => recordKitOpen(slug, ua));
  }
  const handles = kit.platforms.filter((p) => p.handle).map((p) => ({ platform: p.platform, handle: p.handle! }));
  const totalFollowers = kit.platforms.reduce((n, p) => n + (p.followers ?? 0), 0);
  return (
    <main className="kit">
      <header className="kit-head">
        {kit.photo ? (
          // Their own photo from storage; next/image would need every storage host configured.
          // eslint-disable-next-line @next/next/no-img-element
          <img className="kit-photo" src={kit.photo} alt={`@${kit.name}`} width={96} height={96} />
        ) : null}
        <div>
          <p className="kit-kicker">Media kit{kit.forBrand ? ` · for ${kit.forBrand.brand}` : ""}</p>
          <h1>@{kit.name}</h1>
          {kit.oneLine ? <p className="kit-line">{kit.oneLine}</p> : kit.lane ? <p className="kit-line">{kit.lane}</p> : null}
          <p className="kit-meta">
            {handles.map((h) => `${PLATFORM[h.platform]} @${h.handle}`).join(" · ")}
            {kit.region ? ` · ${kit.region}` : ""}
          </p>
        </div>
      </header>

      {kit.forBrand ? (
        <section className="kit-idea" aria-label={`An idea for ${kit.forBrand.brand}`}>
          <p className="kit-kicker">An idea for {kit.forBrand.brand}</p>
          <p>{kit.forBrand.idea}</p>
        </section>
      ) : null}

      {totalFollowers > 0 && kit.platforms.length > 1 ? <p className="kit-total"><b>{fmt(totalFollowers)}</b> followers across TikTok and Instagram</p> : null}

      {kit.platforms.map((p) => (
        <section key={p.platform} className="kit-platform">
          <h2>{PLATFORM[p.platform] ?? p.platform}{p.handle ? <span> @{p.handle}</span> : null}</h2>
          <div className="kit-stats">
            <div><b>{p.followers !== null ? fmt(p.followers) : "—"}</b><small>followers</small></div>
            <div><b>{p.normalViews !== null ? fmt(p.normalViews) : "—"}</b><small>typical views per post</small></div>
            <div><b>{p.engagement ? pct(p.engagement.perView) : "—"}</b><small>engagement (of views)</small></div>
            <div><b>{p.growth30d ? `${p.growth30d.net >= 0 ? "+" : ""}${fmt(p.growth30d.net)}` : "—"}</b><small>followers, last 30 days</small></div>
          </div>
          {p.audience ? (
            <div className="kit-audience">
              <p className="kit-kicker">Who watches{p.audience.source === "tiktok_studio" ? " (from TikTok Studio)" : ""}</p>
              {p.audience.gender.length ? <p>{p.audience.gender.map((g) => `${pct(g.share)} ${g.label.toLowerCase()}`).join(" · ")}</p> : null}
              {p.audience.age.length ? (
                <ul className="kit-bars" aria-label="Age">
                  {[...p.audience.age].sort((a, b) => b.share - a.share).slice(0, 4).map((a) => (
                    <li key={a.label}><span>{a.label}</span><i style={{ width: `${Math.max(4, a.share * 100)}%` }} /><em>{pct(a.share)}</em></li>
                  ))}
                </ul>
              ) : null}
              {p.audience.countries.length ? <p>Top places: {p.audience.countries.slice(0, 3).map((c) => `${c.label} ${pct(c.share)}`).join(" · ")}</p> : null}
            </div>
          ) : null}
          {p.best.length ? (
            <ul className="kit-posts">
              {p.best.map((b) => (
                <li key={b.url}>
                  <a href={b.url} rel="noopener noreferrer" target="_blank">
                    {b.cover ? (
                      // eslint-disable-next-line @next/next/no-img-element -- stored covers, same reason as the photo
                      <img src={b.cover} alt="" loading="lazy" />
                    ) : <span className="kit-cover-none" aria-hidden="true" />}
                    <span className="kit-post-meta">
                      <b>{fmt(b.views)} views</b>
                      {b.multiple && b.multiple >= 1.5 ? <em>{b.multiple.toFixed(1)}× usual</em> : null}
                    </span>
                    {b.caption ? <span className="kit-caption">{b.caption}</span> : null}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}

      {kit.services.length || kit.brandWork.length ? (
        <section className="kit-work">
          {kit.services.length ? (
            <div>
              <p className="kit-kicker">Open to</p>
              <ul className="kit-chips">{kit.services.map((s) => <li key={s}>{s}</li>)}</ul>
            </div>
          ) : null}
          {kit.brandWork.length ? (
            <div>
              <p className="kit-kicker">Has worked with</p>
              <ul className="kit-chips">{kit.brandWork.map((b) => <li key={b}>{b}</li>)}</ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {kit.contactEmail ? (
        <section className="kit-contact">
          <a href={`mailto:${kit.contactEmail}`}>{kit.contactEmail}</a>
        </section>
      ) : null}

      <footer className="kit-foot">
        <p>Numbers from their accounts, as of {kit.asOf}. Engagement is likes, comments, shares and saves per view, the median of the last 90 days.</p>
        <PrintButton />
      </footer>
    </main>
  );
}
