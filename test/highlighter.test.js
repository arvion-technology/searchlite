import test from "node:test";
import assert from "node:assert/strict";
import { segmentText, snippet, matchersForClauses } from "../src/highlighter.js";
import { parseQuery } from "../src/tokenizer.js";

test("segmentText marks whole tokens only, case-insensitively", () => {
  const segments = segmentText("Retrying retries retry harder", [{ term: "retry", prefix: false }]);
  assert.equal(segments.map((segment) => segment.text).join(""), "Retrying retries retry harder");
  assert.deepEqual(segments.filter((segment) => segment.match).map((segment) => segment.text), ["retry"]);
  assert.equal(segments.map((segment) => segment.text).join(""), "Retrying retries retry harder");
  assert.equal(segmentText("anything", []).length, 1);
  assert.equal(segmentText("", []).length, 0);
});

test("prefix matching marks every token with that prefix", () => {
  const segments = segmentText("retry retries reuse", [{ term: "ret", prefix: true }]);
  assert.deepEqual(segments.filter((segment) => segment.match).map((segment) => segment.text), ["retry", "retries"]);
});

test("a snippet starts near the first match and reports clipping", () => {
  const body = "one two three four five six seven eight nine ten eleven retry twelve thirteen fourteen fifteen sixteen";
  const result = snippet(body, [{ term: "retry", prefix: false }], { words: 8, before: 2 });
  assert.match(result.text, /retry/);
  assert.equal(result.clippedStart, true);
  assert.equal(result.clippedEnd, false);
  assert.ok(result.segments.some((segment) => segment.match && segment.text === "retry"));
  assert.ok(result.text.length < body.length);
});

test("no match returns the head of the text, marked as clipped when shortened", () => {
  const long = "word ".repeat(100);
  const result = snippet(long, [{ term: "absent", prefix: false }], { words: 5 });
  assert.equal(result.clippedStart, false);
  assert.equal(result.clippedEnd, true);
  assert.ok(result.text.endsWith("…"));
});

test("segments are plain strings — a script tag is never interpreted", () => {
  const malicious = "hello <script>alert(1)</script> retry";
  const segments = segmentText(malicious, [{ term: "retry", prefix: false }]);
  assert.ok(segments.some((segment) => segment.text.includes("<script>") && !segment.match));
  assert.ok(segments.every((segment) => typeof segment.text === "string"));
});

test("matchersForClauses uses surface terms and prefix flags", () => {
  const clauses = parseQuery('"exponential backoff" retr* jitter~1');
  const matchers = matchersForClauses(clauses);
  assert.deepEqual(matchers, [
    { term: "exponential", prefix: false },
    { term: "backoff", prefix: false },
    { term: "retr", prefix: true },
    { term: "jitter", prefix: false },
  ]);
});
