import { SignUp } from "@clerk/nextjs";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const redirectUrl = firstParam((await searchParams).redirect_url);

  return (
    <main className="relative z-10 flex min-h-screen items-center justify-center bg-[var(--ink)] px-6 py-16">
      <SignUp
        signInUrl="/sign-in"
        fallbackRedirectUrl="/start"
        forceRedirectUrl={redirectUrl}
      />
    </main>
  );
}
