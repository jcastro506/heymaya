import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-16 bg-[var(--ink)]">
      <SignUp signInUrl="/sign-in" forceRedirectUrl="/onboarding/maya" />
    </main>
  );
}
