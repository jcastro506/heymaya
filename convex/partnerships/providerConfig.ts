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

/**
 * Email sending: the deployment's switch (PARTNERSHIP_EMAIL_SEND_ENABLED), or an isolated eval fixture
 * on a local deployment with the fakes on, whose mailbox holds only the fake token and so can only
 * ever reach the fake Gmail. Lets the deals simulation send without switching sending on for everyone. Pure.
 */
export function emailSendEnabled(c: { clerkUserId: string; telegramChatId?: string; phone?: string } | null, env: Record<string, string | undefined> = process.env): boolean {
  if (env.PARTNERSHIP_EMAIL_SEND_ENABLED === "true") return true;
  return Boolean(c && env.EVAL_FAKES === "1" && env.ENVIRONMENT_NAME === "local" && c.clerkUserId.startsWith("eval:partnership:") && !c.telegramChatId && !c.phone);
}
