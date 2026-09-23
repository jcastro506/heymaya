/**
 * The one piece of product UI the web keeps (app spec §2): someone tapped Maya's link to an
 * idea or a post without the app installed, or on a Mac where iMessage syncs. It says what the
 * link is, offers the app, and never shows the object's contents (no session here, by design).
 */
import Link from "next/link";

const WHAT: Record<string, string> = {
  idea: "an idea Maya sent you",
  post: "one of your posts and its numbers",
};

export default async function OpenInApp({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind } = await params;
  const store = process.env.NEXT_PUBLIC_APP_STORE_URL;
  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", background: "#fcfbf8", color: "#29233f", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 420, textAlign: "center" }}>
        <div style={{ fontSize: 56 }} aria-hidden>✿</div>
        <h1 style={{ fontSize: 28, margin: "12px 0 8px" }}>This opens in the Maya app</h1>
        <p style={{ color: "#756e84", lineHeight: 1.5 }}>
          It&apos;s {WHAT[kind] ?? "something from Maya"}. Open this link on your iPhone with the app installed and it goes straight there.
        </p>
        {store ? (
          <a href={store} style={{ display: "inline-block", marginTop: 20, background: "#7661b4", color: "#fff", padding: "14px 22px", borderRadius: 14, textDecoration: "none", fontWeight: 600 }}>
            Get the Maya app
          </a>
        ) : (
          <p style={{ marginTop: 20, color: "#756e84" }}>The app is in testing. Ask Maya for an invite.</p>
        )}
        <p style={{ marginTop: 24 }}><Link href="/" style={{ color: "#7661b4" }}>hey-maya.ai</Link></p>
      </div>
    </main>
  );
}
