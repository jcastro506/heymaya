import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <main className="relative z-10 flex min-h-screen items-center justify-center bg-[var(--ink)] px-6 py-16">
      <SignIn signUpUrl="/sign-up" fallbackRedirectUrl="/creator-maya-v0" />
    </main>
  );
}
