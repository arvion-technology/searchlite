import test from "node:test";
import assert from "node:assert/strict";
import {
  tokenize, analyze, parseQuery, isStopword, editDistance, DEFAULT_STOPWORDS,
} from "../src/tokenizer.js";

test("tokenizer lowercases and splits on punctuation and unicode boundaries", () => {
  assert.deepEqual(tokenize("Hello, world! It's 2026."), ["hello", "world", "it", "s", "2026"]);
  assert.deepEqual(tokenize("naïve café"), ["naïve", "café"]);
  assert.deepEqual(tokenize("backoff-based retries"), ["backoff", "based", "retries"]);
  assert.deepEqual(tokenize(""), []);
  assert.deepEqual(tokenize(null), []);
});

test("analyze keeps positions and flags stopwords", () => {
  const tokens = analyze("The quick brown fox", { stem: false });
  assert.deepEqual(tokens.map((token) => token.raw), ["the", "quick", "brown", "fox"]);
  assert.deepEqual(tokens.map((token) => token.position), [0, 1, 2, 3]);
  assert.equal(tokens[0].stopword, true);
  assert.equal(tokens[1].stopword, false);
  const stemmed = analyze("running retries");
  assert.deepEqual(stemmed.map((token) => token.term), ["run", "retri"]);
});

test("stopword detection uses the default list", () => {
  assert.equal(isStopword("the"), true);
  assert.equal(isStopword("queue"), false);
  assert.ok(DEFAULT_STOPWORDS.includes("and"));
});

test("parseQuery understands terms, phrases, prefixes and fuzzy clauses", () => {
  const clauses = parseQuery('queue "exponential backoff" retr* jitter~1 the');
  assert.equal(clauses.length, 4);
  assert.deepEqual(clauses[0], { type: "term", term: "queue", rawTerm: "queue" });
  assert.equal(clauses[1].type, "phrase");
  assert.deepEqual(clauses[1].rawTerms, ["exponential", "backoff"]);
  assert.equal(clauses[2].type, "prefix");
  assert.equal(clauses[2].rawTerm, "retr");
  assert.equal(clauses[3].type, "fuzzy");
  assert.equal(clauses[3].distance, 1);
  // "the" is a stopword and never becomes a clause.
  assert.equal(clauses.some((clause) => clause.rawTerm === "the"), false);
});

test("parseQuery handles empty and punctuation-only input", () => {
  assert.deepEqual(parseQuery(""), []);
  assert.deepEqual(parseQuery("!!! ***"), []);
  assert.deepEqual(parseQuery('""'), []);
  assert.equal(parseQuery('"a the"').length, 0);
});

test("editDistance counts insertions, deletions and substitutions", () => {
  assert.equal(editDistance("kitten", "kitten"), 0);
  assert.equal(editDistance("kitten", "sitten"), 1);
  assert.equal(editDistance("kitten", "kittens"), 1);
  assert.equal(editDistance("jitter", "jiter"), 1);
  assert.equal(editDistance("backoff", "backof"), 1);
  assert.equal(editDistance("backoff", "bakcoff"), 2);
  assert.equal(editDistance("a", "abcdef"), 3); // early-exit sentinel
});
