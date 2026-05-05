import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <main className="relative z-10 flex min-h-screen items-center justify-center bg-[var(--ink)] px-6 py-16">
      <SignUp signInUrl="/sign-in" fallbackRedirectUrl="/creator-maya-v0" />
    </main>
  );
}
