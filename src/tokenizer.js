// Tokenizer and query analysis.
//
// The index keeps every token (including stopwords) so phrase positions stay
// faithful to the source text. Stopwords are dropped from *queries* instead;
// that keeps `"the quick brown fox"` searchable without shifting positions.

import { porterStem } from "./porter.js";

export const DEFAULT_STOPWORDS = Object.freeze([
  "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "can", "could",
  "did", "do", "does", "for", "from", "had", "has", "have", "he", "her", "his",
  "how", "i", "if", "in", "into", "is", "it", "its", "may", "me", "might", "more",
  "most", "my", "no", "not", "of", "on", "or", "our", "out", "over", "said", "same",
  "she", "should", "so", "some", "such", "than", "that", "the", "their", "them",
  "then", "there", "these", "they", "this", "those", "through", "to", "too", "under",
  "up", "us", "was", "we", "were", "what", "when", "where", "which", "while", "who",
  "why", "will", "with", "would", "you", "your",
]);

/** Split on anything that is not a letter or digit; lowercase; drop empties. */
export function tokenize(text) {
  if (typeof text !== "string") return [];
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

export function isStopword(token, stopwords = DEFAULT_STOPWORDS) {
  return stopwords.includes(token);
}

/**
 * Analyze a document field. Returns tokens with their positions in the original
 * token stream, which is what phrase queries need.
 */
export function analyze(text, { stopwords = DEFAULT_STOPWORDS, stem = true } = {}) {
  const raw = tokenize(text);
  const out = [];
  for (let position = 0; position < raw.length; position++) {
    const token = raw[position];
    out.push({
      raw: token,
      position,
      term: stem ? porterStem(token) : token,
      stopword: isStopword(token, stopwords),
    });
  }
  return out;
}

/**
 * Turn a query string into clauses.
 *
 * Supported syntax:
 *   plain words        AND-ed terms
 *   "exact phrase"     consecutive positions in one field
 *   prefix*            any indexed term with that prefix
 *   fuzzy~1            terms within one edit of the term (1 or 2 supported)
 */
export function parseQuery(input, { stopwords = DEFAULT_STOPWORDS, stem = true } = {}) {
  if (typeof input !== "string") return [];
  const clauses = [];
  const pattern = /"([^"]+)"|(\S+)/g;
  let match;
  while ((match = pattern.exec(input)) !== null) {
    if (match[1] !== undefined) {
      const tokens = tokenize(match[1]).filter((token) => !isStopword(token, stopwords));
      if (!tokens.length) continue;
      clauses.push({
        type: "phrase",
        text: match[1],
        terms: tokens.map((token) => (stem ? porterStem(token) : token)),
        rawTerms: tokens,
      });
      continue;
    }
    const word = match[2];
    const prefix = word.endsWith("*");
    const fuzzyMatch = word.match(/^(.+?)~([12])$/);
    if (fuzzyMatch) {
      const token = fuzzyMatch[1].toLowerCase();
      if (!/[\p{L}\p{N}]/u.test(token) || isStopword(token, stopwords)) continue;
      clauses.push({ type: "fuzzy", term: stem ? porterStem(token) : token, rawTerm: token, distance: Number(fuzzyMatch[2]) });
    } else if (prefix) {
      const token = word.slice(0, -1).toLowerCase();
      if (!/[\p{L}\p{N}]/u.test(token) || isStopword(token, stopwords)) continue;
      clauses.push({ type: "prefix", term: stem ? porterStem(token) : token, rawTerm: token });
    } else {
      const token = word.toLowerCase();
      if (!/[\p{L}\p{N}]/u.test(token) || isStopword(token, stopwords)) continue;
      clauses.push({ type: "term", term: stem ? porterStem(token) : token, rawTerm: token });
    }
  }
  return clauses;
}

/** Levenshtein distance with early exit; small strings only. */
export function editDistance(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 3;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const prev = new Array(cols);
  const current = new Array(cols);
  for (let j = 0; j < cols; j++) prev[j] = j;
  for (let i = 1; i < rows; i++) {
    current[0] = i;
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(prev[j] + 1, current[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j < cols; j++) prev[j] = current[j];
  }
  return prev[b.length];
}
