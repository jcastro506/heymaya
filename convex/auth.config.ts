// Clerk JWT validation. The issuer URL must match what Clerk emits.
// Read it from the Clerk Dashboard: API Keys → Show JWT Public Key → "Issuer".
// Configured per-deployment via Convex cloud env.
//
// No fallback: a hardcoded issuer means HeyMaya users could authenticate
// against the wrong Clerk project if the env var goes missing. Fail loud.
const issuer = process.env.CLERK_JWT_ISSUER_DOMAIN;
if (!issuer) {
  throw new Error(
    "CLERK_JWT_ISSUER_DOMAIN env var is required. Set it via `npx convex env set CLERK_JWT_ISSUER_DOMAIN https://<your-clerk-frontend-api>`."
  );
}

export default {
  providers: [
    {
      domain: issuer,
      applicationID: "convex",
    },
  ],
};
