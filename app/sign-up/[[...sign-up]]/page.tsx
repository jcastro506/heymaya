import { SignUp } from "@clerk/nextjs";
import { OnboardShell } from "../../onboarding/Shell";

/** The landing's room, with Clerk's card inside it (2026-09-08). */
const appearance = {
  variables: { colorPrimary: "#29233f", colorText: "#29233f", colorTextSecondary: "#756e84", colorBackground: "#ffffff", colorInputBackground: "#ffffff", colorInputText: "#29233f", borderRadius: "10px", fontFamily: "var(--font-instrument), sans-serif" },
  elements: { formButtonPrimary: "bg-[#29233f] hover:bg-[#4a3c66]", card: "shadow-none" },
};

export default function Page() {
  return (
    <OnboardShell where="get started">
      <section>
        <h2>Meet your content person.</h2>
        <p className="muted small">Two minutes to set up. Then she goes to work.</p>
        <SignUp forceRedirectUrl="/start" appearance={appearance} />
      </section>
    </OnboardShell>
  );
}
