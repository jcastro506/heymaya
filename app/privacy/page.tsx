import Link from "next/link";

/** Privacy (plan §7 S1 legal, §16.5). Names the vendors, states the posture, gives the deletion path. Reviewed by a person before launch. */
export default function Privacy() {
  return (
    <main className="max-w-2xl mx-auto px-6 py-12 flex flex-col gap-6 text-sm leading-relaxed">
      <h1 className="text-2xl font-semibold">Privacy</h1>
      <p className="opacity-60">Last updated 2 September 2026. This page describes the pilot. It changes when the product does, and the date changes with it.</p>

      <h2 className="font-semibold text-base">What Maya is</h2>
      <p>Maya is a creator&apos;s assistant for TikTok and Instagram. She reads public posts, watches short videos, reads a calendar you connect, and texts you on Telegram. She is software. Where she uses language and video models, those are named below.</p>

      <h2 className="font-semibold text-base">What we collect from you</h2>
      <ul className="list-disc pl-5 flex flex-col gap-1">
        <li>Your email and sign-in, held by Clerk.</li>
        <li>Your TikTok and Instagram handles, and the handles of accounts you tell us you admire. We never ask for, hold, or use your platform passwords. Ownership of a handle is not verified during the pilot; you are telling us it is yours.</li>
        <li>Your messages with Maya on Telegram, including files, screenshots and voice notes you send her, and her replies.</li>
        <li>What you do with her ideas: reactions, taps, replies, and which ideas you posted. This is how she learns your taste.</li>
        <li>If you connect Google Calendar: event titles, start and end times, the all-day flag and the calendar id, for the next fourteen days, kept for ninety days rolling. Never descriptions, attendees, locations or attachments. Events that look private (health, legal, money, work reviews, relationships) keep no title and are never referenced.</li>
        <li>Billing: your card is held by Stripe. We keep the Stripe customer and subscription ids and your plan status.</li>
      </ul>

      <h2 className="font-semibold text-base">What we read that is public</h2>
      <p>Your public posts and their public counts, and the public posts of the accounts you admire and of accounts in your lane, are read through ScrapeCreators, a vendor that reads what any signed-out visitor can see. We keep captions, transcripts, counts and short written descriptions of how a video is made. We never keep the video files of other people&apos;s posts.</p>

      <h2 className="font-semibold text-base">Who processes it</h2>
      <ul className="list-disc pl-5 flex flex-col gap-1">
        <li><b>Convex</b> stores everything and runs Maya.</li>
        <li><b>Clerk</b> handles sign-in. <b>Stripe</b> handles payment. <b>Telegram</b> carries the chat.</li>
        <li><b>ScrapeCreators</b> reads public posts. <b>Google</b> (Calendar API, and the Gemini models that watch videos and read screenshots). <b>OpenRouter</b> routes text to language models (Google Gemini and Z.ai GLM during the pilot). Prompts sent to models contain your posts, your messages and what Maya knows about you; none of these vendors train on it under the terms we use.</li>
        <li><b>Zernio</b>, when you choose to connect an account for your own analytics after the pilot. Not used during the trial.</li>
        <li><b>PostHog</b> for product analytics on the website, if you accept it. We default to declining.</li>
      </ul>

      <h2 className="font-semibold text-base">Retention</h2>
      <p>Messages twelve months. What she learned from your posts for as long as you have an account. Calendar fields ninety days rolling. Notes until they expire or you confirm them. Public content about other accounts indefinitely, without video files.</p>

      <h2 className="font-semibold text-base">Your export and your deletion</h2>
      <p>From Settings you can download everything we hold about you as one file, and you can delete your account. Deletion is one procedure: your subscription is canceled, your calendar token is revoked at Google and every calendar row deleted, Maya sends a final message and the Telegram pairing is removed, every row keyed to you is deleted, files you sent are deleted, and your sign-in is deleted. Two things remain: Stripe invoices, because tax law requires it, and application logs with ids and no content for thirty days. Public posts of yours that other creators&apos; lanes observed are public information about a public account; if you ask, we remove them by hand.</p>
      <p>The data deletion URL for platform reviews is this page and the Settings procedure it describes: <span className="opacity-70">/app/settings</span>.</p>

      <h2 className="font-semibold text-base">Age</h2>
      <p>Maya is for people 18 and over.</p>

      <h2 className="font-semibold text-base">Contact</h2>
      <p>Write to the founder at the address on the signup email, or tell Maya &ldquo;talk to a person&rdquo; and a person replies in the same chat.</p>

      <p className="opacity-50"><Link className="underline" href="/">Home</Link> · <Link className="underline" href="/terms">Terms</Link></p>
    </main>
  );
}
