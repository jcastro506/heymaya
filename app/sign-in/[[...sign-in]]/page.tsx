import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-16 bg-[var(--ink)]">
      <SignIn signUpUrl="/sign-up" fallbackRedirectUrl="/creator-maya-v0" />
    </main>
  );
}
