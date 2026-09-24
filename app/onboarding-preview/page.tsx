import { notFound } from "next/navigation";
import Link from "next/link";
import { OnboardShell } from "../onboarding/Shell";

const people = [
  { initial: "A", name: "Arielle Vey", handle: "@ariellevey", platform: "Instagram", why: "A strong peer with polished ideas that still feel possible to make." },
  { initial: "J", name: "Jade Darmawangsa", handle: "@jadedarmawangsa", platform: "TikTok", why: "An aspirational voice with formats you can adapt without copying." },
  { initial: "M", name: "Mina Le", handle: "@gremlita", platform: "Instagram", why: "An adjacent creator who could widen the way you tell a story." },
];

export default async function OnboardingPreview({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const requested = Number((await searchParams).step ?? "1");
  const step = Math.min(5, Math.max(1, Number.isFinite(requested) ? requested : 1));
  return (
    <OnboardShell where={`step ${step} of 5`}>
      <div className="onboard-progress">{[1, 2, 3, 4, 5].map((item) => <span className={item <= step ? "is-active" : ""} key={item} />)}</div>
      {step === 1 ? <section>
        <div className="screen-heading"><span className="kicker">Choose how Maya helps</span><h1>Start with the setup that fits you.</h1><p className="muted">Seven days free. Connect your account next, then I’ll start getting to know your work.</p></div>
        <div className="interval-toggle"><button className="selected">Monthly</button><button>Yearly <span>save 2 months</span></button></div>
        <div className="tier-list">{[["One account", "$19", "Everything, for one TikTok or Instagram account."], ["Both accounts", "$24.99", "Everything, for your TikTok and your Instagram."], ["Both plus partnerships", "$29.99", "Opportunities, pitches, and reply tracking."]].map(([name, amount, copy], index) => <article className={`tier-card ${index === 1 ? "featured" : ""}`} key={name}><div><div className="tier-topline"><h2>{name}</h2>{index === 1 ? <span className="mini-badge">most popular</span> : null}</div><p className="muted small">{copy}</p></div><div className="tier-price"><strong>{amount}</strong><span>/mo</span></div><button className="btn">Choose this plan</button></article>)}</div>
      </section> : null}
      {step === 2 ? <section>
        <div className="screen-heading"><span className="kicker">Your work</span><h1>Let me get to know what you make.</h1><p className="muted">Connect Instagram or TikTok. This gives me your real account history and available analytics.</p></div>
        <div className="connection-grid"><article className="connection-card connected"><div className="platform-mark instagram">◎</div><div className="connection-copy"><h2>Instagram</h2><p className="muted small">@joshscreative</p></div><span className="connected-label">Connected</span></article><article className="connection-card"><div className="platform-mark tiktok">♪</div><div className="connection-copy"><h2>TikTok</h2><p className="muted small">Posts, performance, and account history</p></div><button className="btn-secondary">Connect</button></article></div>
        <button className="btn">Continue</button><p className="privacy-note">You stay in control. Maya reads these accounts and never publishes from onboarding.</p>
      </section> : null}
      {step === 3 ? <section>
        <div className="screen-heading"><span className="kicker">Your taste</span><h1>A few creators worth keeping an eye on.</h1><p className="muted">I found people who may be useful for different reasons. Pick any that feel right, add your own, or leave this to me.</p></div>
        <div className="read-card"><span className="read-orbit" /><div><strong>I’m reading your posts now</strong><p className="small muted">I’ll share what I notice in Messages as soon as I have enough evidence.</p></div></div>
        <div className="suggestion-grid">{people.map((person, index) => <article className={`suggestion-card ${index === 0 ? "selected" : ""}`} key={person.handle}><button className="suggestion-select">{index === 0 ? "✓" : "+"}</button><div className="creator-avatar">{person.initial}</div><div><strong>{person.name}</strong><p className="tiny muted">{person.handle} · {person.platform}</p></div><p className="small">{person.why}</p></article>)}</div>
        <div className="manual-creator"><select className="input" defaultValue="instagram"><option value="instagram">Instagram</option><option value="tiktok">TikTok</option></select><input className="input" placeholder="@someone you like" /><button className="btn-secondary">Add</button></div><button className="btn">Use these creators</button>
      </section> : null}
      {step === 4 ? <section>
        <div className="screen-heading"><span className="kicker">Your real week</span><h1>Make the plan fit your life.</h1><p className="muted">I can see what’s coming up, find content in your actual week, and suggest realistic time to film or edit.</p></div>
        <div className="calendar-panel"><div className="calendar-illustration"><span>MON</span><strong>12</strong><i /></div><div><h2>Connect Google Calendar</h2><p className="small muted">Optional. You can always connect it later from Mission Control.</p></div><button className="btn">Connect calendar</button></div><button className="btn-secondary">Skip for now</button>
      </section> : null}
      {step === 5 ? <section>
        <div className="screen-heading"><span className="kicker">Where Maya lives</span><h1>Let’s keep this in Messages.</h1><p className="muted">I’ll text when I find something worth your attention. Reply naturally, send a link, or tell me to remember something.</p></div>
        <label>Your mobile number<input className="input" type="tel" defaultValue="+1 555 123 4567" /></label><div className="settings-pair"><label>Timezone<select className="input"><option>America/New York</option></select></label><div className="quiet-fields"><label>Quiet from<input className="input" type="time" defaultValue="22:00" /></label><label>Until<input className="input" type="time" defaultValue="07:00" /></label></div></div><label className="consent-row"><input type="checkbox" defaultChecked /><span>I agree to receive messages from Maya at this number. Reply STOP anytime.</span></label>
        <div className="finish-card"><div className="finish-flower">✿</div><h2>You’re ready.</h2><p className="muted small">I’m getting to know your posts now. I’ll bring the useful part to you in Messages.</p><button className="btn">Open Messages</button><button className="btn-secondary">Open Mission Control</button></div>
      </section> : null}
      <nav className="preview-nav" aria-label="Preview steps">{[1, 2, 3, 4, 5].map((item) => <Link className={item === step ? "active" : ""} href={`/onboarding-preview?step=${item}`} key={item}>{item}</Link>)}</nav>
    </OnboardShell>
  );
}
