// Highlighting without HTML strings.
//
// The tokenizer decides what a word is; this module returns segments that the
// caller renders as text nodes and <mark> elements. A document containing
// `<script>` stays text, because there is no innerHTML anywhere on this path.

const WORD = /[\p{L}\p{N}]+/gu;

/** A matcher is {term, prefix} where term is lowercase (unstemmed). */
export function segmentText(text, matchers = []) {
  if (!text) return [];
  const segments = [];
  let cursor = 0;
  for (const match of text.matchAll(WORD)) {
    const token = match[0];
    const lower = token.toLowerCase();
    const isMatch = matchers.some((matcher) => (matcher.prefix ? lower.startsWith(matcher.term) : lower === matcher.term));
    if (!isMatch) continue;
    if (match.index > cursor) segments.push({ text: text.slice(cursor, match.index), match: false });
    segments.push({ text: token, match: true });
    cursor = match.index + token.length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
  if (!segments.length) return [{ text, match: false }];
  return segments;
}

/**
 * Pick a window of words around the first match and return segments for it.
 * Returns `{ text, segments, clippedStart, clippedEnd }`; the caller can show
 * ellipses based on the flags.
 */
export function snippet(text, matchers = [], { words = 30, before = 8 } = {}) {
  const tokens = [...text.matchAll(WORD)];
  if (!tokens.length) return { text: "", segments: [], clippedStart: false, clippedEnd: false };

  let firstMatch = -1;
  for (let i = 0; i < tokens.length; i++) {
    const lower = tokens[i][0].toLowerCase();
    if (matchers.some((matcher) => (matcher.prefix ? lower.startsWith(matcher.term) : lower === matcher.term))) {
      firstMatch = i;
      break;
    }
  }
  if (firstMatch === -1) {
    const truncated = text.length > words * 7 ? text.slice(0, words * 7).trimEnd() + "…" : text;
    return { text: truncated, segments: segmentText(truncated, matchers), clippedStart: false, clippedEnd: truncated.length < text.length };
  }

  const startToken = Math.max(0, firstMatch - before);
  const endToken = Math.min(tokens.length, startToken + words);
  const start = tokens[startToken].index;
  const end = tokens[endToken - 1].index + tokens[endToken - 1][0].length;
  const window = text.slice(start, end);
  return {
    text: window,
    segments: segmentText(window, matchers),
    clippedStart: start > 0,
    clippedEnd: end < text.length,
  };
}

/** Turn query clauses into highlight matchers (unstemmed surface terms). */
export function matchersForClauses(clauses = []) {
  const matchers = [];
  const seen = new Set();
  for (const clause of clauses) {
    if (clause.type === "phrase") {
      for (const term of clause.rawTerms ?? []) {
        if (seen.has(term)) continue;
        seen.add(term);
        matchers.push({ term, prefix: false });
      }
    } else if (clause.type === "prefix") {
      const term = (clause.rawTerm ?? clause.term).toLowerCase();
      if (!term || seen.has(term + "*")) continue;
      seen.add(term + "*");
      matchers.push({ term, prefix: true });
    } else {
      const term = (clause.rawTerm ?? clause.term).toLowerCase();
      if (!term || seen.has(term)) continue;
      seen.add(term);
      matchers.push({ term, prefix: false });
    }
  }
  return matchers;
}
