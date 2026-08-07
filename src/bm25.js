// BM25 scoring.
//
//   score(q, d) = Σ idf(q) * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * |d| / avgdl))
//
// idf uses the +0.5 smoothed form so a term in every document still scores
// slightly above zero instead of going negative. k1 controls saturation and b
// controls length normalisation; both are exposed in the demo's relevance lab.

export const DEFAULT_K1 = 1.2;
export const DEFAULT_B = 0.75;

export function idf(df, N) {
  if (!Number.isFinite(df) || !Number.isFinite(N) || N <= 0) return 0;
  return Math.log(1 + (N - df + 0.5) / (df + 0.5));
}

export function termScore({ tf, fieldLength, avgFieldLength, df, N, k1 = DEFAULT_K1, b = DEFAULT_B }) {
  if (!tf) return 0;
  const lengthNorm = avgFieldLength > 0 ? fieldLength / avgFieldLength : 1;
  const denominator = tf + k1 * (1 - b + b * lengthNorm);
  return idf(df, N) * ((tf * (k1 + 1)) / denominator);
}

/** Score a term across the fields it appears in, with per-field weights. */
export function fieldTermScore({ fields, df, N, k1, b }) {
  let score = 0;
  const parts = [];
  for (const field of fields) {
    const value = termScore({
      tf: field.tf,
      fieldLength: field.length,
      avgFieldLength: field.avgLength,
      df,
      N,
      k1,
      b,
    });
    const weighted = value * field.weight;
    score += weighted;
    parts.push({ field: field.name, tf: field.tf, weight: field.weight, score: weighted });
  }
  return { score, parts };
}
