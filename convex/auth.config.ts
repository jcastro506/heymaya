// Clerk as the identity provider for Convex (plan §20.2). The issuer domain is per
// environment (development vs production Clerk instance) and lives in the deployment's env.
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN,
      applicationID: "convex",
    },
  ],
};
