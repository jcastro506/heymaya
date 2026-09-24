/**
 * B6: a creator's public media kit (audit §8.2), the link they paste into a pitch or a brand's
 * form. Public numbers only, read live from their rows; an unknown or revoked link is a 404.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { readPublicKit } from "@/lib/publicKit";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Media kit", robots: { index: false, follow: false } };

const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K` : String(Math.round(n)));
const PLATFORM: Record<string, string> = { tiktok: "TikTok", instagram: "Instagram" };

export default async function MediaKit({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const kit = await readPublicKit(slug);
  if (!kit) notFound();
  return (
    <main style={{ minHeight: "100dvh", background: "#fcfbf8", color: "#29233f", padding: "40px 16px", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 560, margin: "0 auto" }}>
        <p style={{ color: "#756e84", fontSize: 14, margin: 0 }}>Media kit</p>
        <h1 style={{ fontSize: 32, margin: "4px 0 6px" }}>@{kit.name}</h1>
        {kit.lane ? <p style={{ color: "#756e84", margin: 0, lineHeight: 1.5 }}>{kit.lane}</p> : null}
        {kit.platforms.map((p) => (
          <section key={p.platform} style={{ marginTop: 28, background: "#fff", border: "1px solid #ece8f2", borderRadius: 16, padding: 20 }}>
            <h2 style={{ fontSize: 18, margin: 0 }}>{PLATFORM[p.platform] ?? p.platform}{p.handle ? <span style={{ color: "#756e84", fontWeight: 400 }}> · @{p.handle}</span> : null}</h2>
            <div style={{ display: "flex", gap: 32, marginTop: 14 }}>
              <div><div style={{ fontSize: 26, fontWeight: 700 }}>{p.followers !== null ? fmt(p.followers) : "—"}</div><div style={{ color: "#756e84", fontSize: 13 }}>followers</div></div>
              <div><div style={{ fontSize: 26, fontWeight: 700 }}>{p.normalViews !== null ? fmt(p.normalViews) : "—"}</div><div style={{ color: "#756e84", fontSize: 13 }}>typical views per post</div></div>
            </div>
            {p.best.length ? (
              <ul style={{ listStyle: "none", padding: 0, margin: "18px 0 0" }}>
                {p.best.map((b) => (
                  <li key={b.url} style={{ padding: "10px 0", borderTop: "1px solid #f1eef6" }}>
                    <a href={b.url} style={{ color: "#29233f", textDecoration: "none" }} rel="noopener noreferrer" target="_blank">
                      <strong>{fmt(b.views)} views</strong> <span style={{ color: "#756e84" }}>· {b.caption || "view post"}</span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}
        <p style={{ color: "#a39cb0", fontSize: 12, marginTop: 28 }}>Numbers from public posts, as of {kit.asOf}.</p>
      </div>
    </main>
  );
}
