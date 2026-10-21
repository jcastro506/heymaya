/** Where a Gmail link ends (2026-10-21): one plain line, then back to Messages. Not indexed. */
import type { Metadata } from "next";
import "../../m/[code]/send.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Maya", robots: { index: false, follow: false } };

const WORDS: Record<string, { title: string; help: string }> = {
  connected: { title: "Gmail connected.", help: "You can close this and go back to Messages. Maya just texted you." },
  denied: { title: "No problem, nothing was connected.", help: "Your pitches still work from the link in your texts." },
  used: { title: "This link was already used.", help: "If you need a new one, ask Maya to connect your Gmail." },
  expired: { title: "This link expired.", help: "Ask Maya to connect your Gmail and she'll send a fresh one." },
  unknown: { title: "This link doesn't work.", help: "Ask Maya to connect your Gmail and she'll send a fresh one." },
  unavailable: { title: "Connecting Gmail isn't available right now.", help: "Your pitches still work from the link in your texts." },
  failed: { title: "That didn't go through.", help: "Ask Maya to connect your Gmail and she'll send a fresh link." },
};

export default async function GmailDone({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const { state } = await searchParams;
  const w = WORDS[state ?? ""] ?? WORDS.failed;
  return (
    <main className="send">
      <p className="send-kicker">From Maya</p>
      <h1>{w.title}</h1>
      <p className="send-help">{w.help}</p>
    </main>
  );
}
