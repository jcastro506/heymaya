/** Overrides are local evaluation plumbing, never arbitrary credential destinations. */
export function providerBase(provider: "gmail" | "tavily", fixture: boolean): string {
  const real = provider === "gmail" ? "https://gmail.googleapis.com/gmail/v1/users/me" : "https://api.tavily.com";
  if (!fixture) return real;
  const override = process.env[provider === "gmail" ? "GMAIL_BASE_URL" : "TAVILY_BASE_URL"];
  if (process.env.EVAL_FAKES !== "1" || process.env.ENVIRONMENT_NAME !== "local" || !override || !process.env.CONVEX_SITE_URL) throw new Error("Local fake provider is not configured");
  const expected = `${new URL(process.env.CONVEX_SITE_URL).origin}/fake/${provider}`;
  if (override.replace(/\/$/, "") !== expected) throw new Error("Fake provider must use this deployment's exact fake route");
  return expected;
}
