/**
 * The model registry (plan §4). One place; the model-swap test runs before any edit.
 * Prices verified 2026-09-01 via mirrors; re-verify in the OpenRouter dashboard.
 *
 * Tonight every text role goes through OpenRouter (the writer is Gemini 3.7 Flash
 * either way); the direct-to-Google writer path (§12.4 topology) is a follow-up
 * once explicit prompt caching is wired. Video watching is Gemini direct (§12.3).
 */

export type ModelRole = "writer" | "screener" | "critic" | "classifier";

export interface ModelSpec {
  primary: string;
  fallback: string;
  /** Different family from the writer is required for the critic (plan §15.5). */
  family: "google" | "zai" | "deepseek" | "openai";
  maxTokens: number;
  temperature: number;
  json?: boolean;
}

const env = (name: string, dflt: string): string => process.env[name] ?? dflt;

export const REGISTRY: Record<ModelRole, ModelSpec> = {
  writer: {
    primary: env("MODEL_WRITER", "google/gemini-3.7-flash"),
    fallback: env("MODEL_WRITER_FALLBACK", "google/gemini-3.6-flash"),
    family: "google",
    maxTokens: 700,
    temperature: 0.7,
  },
  screener: {
    primary: env("MODEL_SCREENER", "z-ai/glm-5.3-flash"),
    fallback: env("MODEL_SCREENER_FALLBACK", "deepseek/deepseek-v4-flash"),
    family: "zai",
    maxTokens: 300,
    temperature: 0,
    json: true,
  },
  critic: {
    primary: env("MODEL_CRITIC", "z-ai/glm-5.3-flash"),
    fallback: env("MODEL_CRITIC_FALLBACK", "deepseek/deepseek-v4-flash"),
    family: "zai",
    maxTokens: 400,
    temperature: 0,
    json: true,
  },
  classifier: {
    primary: env("MODEL_CLASSIFIER", "z-ai/glm-5.3-flash"),
    fallback: env("MODEL_CLASSIFIER_FALLBACK", "deepseek/deepseek-v4-flash"),
    family: "zai",
    maxTokens: 120,
    temperature: 0,
    json: true,
  },
};

/** The watch model is called direct (Google), never through OpenRouter. */
export const WATCH_MODEL = env("MODEL_WATCH", "gemini-3.1-flash-lite");
export const WATCH_MODEL_TOP = env("MODEL_WATCH_TOP", "gemini-3.7-flash");

/** Registry invariant, asserted by the model-swap test: the critic never shares the writer's family. */
export function criticFamilyDiffersFromWriter(): boolean {
  return REGISTRY.critic.family !== REGISTRY.writer.family;
}
