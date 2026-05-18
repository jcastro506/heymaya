import { SignIn } from "@clerk/nextjs";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const redirectUrl = firstParam((await searchParams).redirect_url);

  return (
    <main className="relative z-10 flex min-h-screen items-center justify-center bg-[var(--ink)] px-6 py-16">
      <SignIn
        signUpUrl="/sign-up"
        fallbackRedirectUrl="/today"
        forceRedirectUrl={redirectUrl}
      />
    </main>
  );
}
