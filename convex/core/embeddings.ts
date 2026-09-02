/**
 * Embedding-backed complaint similarity.
 *
 * ## Why this exists
 *
 * The ranked complaint list IS the content plan (§5.0.0), so under-clustering
 * is the expensive failure: the same complaint said three different ways
 * appears as three frequency-1 items and never rises to the top. Word overlap
 * cannot see that. Measured against the live Gemini endpoint, 2026-07-31:
 *
 * | pair | Jaccard | cosine |
 * |---|---|---|
 * | "pricing page is confusing…" vs "I genuinely cannot work out what this would cost me" | 0.07 | **0.71** |
 * | "migrations keep timing out on large tables" vs "schema changes just hang forever on big datasets" | 0.00 | **0.81** |
 * | two genuinely different complaints | 0.00 | 0.58 |
 * | a complaint vs unrelated praise | 0.00 | 0.64 |
 *
 * ## The honest caveat about the threshold
 *
 * That table is FIVE strings. The separation is real but the band is narrow —
 * the highest non-match scored 0.64 and the lowest true match 0.71, so
 * `COSINE_CLUSTER_THRESHOLD` sits between them with about 0.07 of headroom on
 * either side. Notably, *unrelated praise* scored HIGHER against a complaint
 * (0.64) than two different complaints did against each other (0.58), which is
 * a reminder that cosine measures topical relatedness, not "same grievance".
 *
 * Treat the constant as calibrated, not derived. It wants a real corpus and a
 * re-measure — which is why it's exported, documented, and has its own test.
 *
 * `taskType: SEMANTIC_SIMILARITY` was measured and made no difference on this
 * model; the scores were identical to the untyped call. Not sent, to avoid
 * implying it does something.
 */

"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";

/**
 * Calibrated 2026-07-31 against a five-string sample. Sits between the highest
 * observed non-match (0.64) and the lowest true match (0.71). Re-measure
 * against a real corpus before trusting it at scale.
 */
export const COSINE_CLUSTER_THRESHOLD = 0.68;

const MODEL = "gemini-embedding-2";
/** Fixed so the vector index (schema `memories.by_embedding`) and every stored row agree. */
export const EMBEDDING_DIMENSIONS = 768;

/** Cosine similarity. Pure — the reason clustering stays testable offline. */
export function cosineSimilarity(
  a: ReadonlyArray<number>,
  b: ReadonlyArray<number>
): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Build a similarity function from precomputed vectors.
 *
 * Falls back to `0` for any text we have no vector for, so a partial embedding
 * failure degrades to "these two don't cluster" rather than throwing mid-sweep.
 * Under-clustering is the safe direction to fail: the complaint still appears,
 * just at frequency 1.
 */
export function similarityFromVectors(
  vectors: ReadonlyMap<string, ReadonlyArray<number>>
): (a: string, b: string) => number {
  return (a, b) => {
    const va = vectors.get(a);
    const vb = vectors.get(b);
    if (!va || !vb) return 0;
    return cosineSimilarity(va, vb);
  };
}

/**
 * Embed a batch of texts. Returns a map keyed by the ORIGINAL text, so callers
 * can look vectors up without tracking indices.
 *
 * Every failure is swallowed into a missing entry rather than an exception:
 * a sweep that can't embed should still produce a complaint list, and the
 * caller falls back to word overlap.
 */
export const embedTexts = internalAction({
  args: { texts: v.array(v.string()) },
  handler: async (
    _ctx,
    args
  ): Promise<{ vectors: Array<{ text: string; values: number[] }>; failed: number }> => {
    const key = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
    if (!key) {
      console.error("[maya.embeddings] GEMINI_API_KEY missing — falling back to word overlap");
      return { vectors: [], failed: args.texts.length };
    }

    const vectors: Array<{ text: string; values: number[] }> = [];
    let failed = 0;

    // Sequential: this runs on a sweep, not a user turn, and a burst of
    // parallel embed calls is how you discover a rate limit you didn't know
    // about — during the one job that was supposed to be cheap and quiet.
    for (const text of args.texts) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:embedContent?key=${key}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: { parts: [{ text }] }, outputDimensionality: EMBEDDING_DIMENSIONS }),
          }
        );
        if (!response.ok) {
          failed += 1;
          continue;
        }
        const body = (await response.json()) as {
          embedding?: { values?: number[] };
        };
        const values = body.embedding?.values;
        if (!Array.isArray(values) || values.length === 0) {
          failed += 1;
          continue;
        }
        vectors.push({ text, values });
      } catch {
        failed += 1;
      }
    }

    if (failed > 0) {
      console.error(
        `[maya.embeddings] ${failed} of ${args.texts.length} texts failed to embed — those fall back to word overlap`
      );
    }
    return { vectors, failed };
  },
});
