/**
 * P1: where Stripe hands them back after a plan change started in the iPhone app. The plan
 * itself lands from the webhook (the app is already watching for it); this page only sends
 * them back. `maya://` opens the app; the text covers a Mac or a phone without it.
 */
const COPY: Record<string, { title: string; body: string }> = {
  started: { title: "You're in", body: "Head back to Maya. Your plan shows up there in a few seconds." },
  changed: { title: "Plan changed", body: "Head back to Maya. The change shows up there in a few seconds." },
  canceled: { title: "Nothing changed", body: "No charge. Head back to Maya whenever you like." },
  done: { title: "All set", body: "Head back to Maya." },
};

export default async function BillingReturn({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const { state } = await searchParams;
  const c = COPY[state ?? "done"] ?? COPY.done;
  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", background: "#fcfbf8", color: "#29233f", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 420, textAlign: "center" }}>
        <div style={{ fontSize: 56 }} aria-hidden>✿</div>
        <h1 style={{ fontSize: 28, margin: "12px 0 8px" }}>{c.title}</h1>
        <p style={{ color: "#756e84", lineHeight: 1.5 }}>{c.body}</p>
        <a href="maya://app/you" style={{ display: "inline-block", marginTop: 20, background: "#7661b4", color: "#fff", padding: "14px 22px", borderRadius: 14, textDecoration: "none", fontWeight: 600 }}>
          Back to Maya
        </a>
      </div>
    </main>
  );
}
