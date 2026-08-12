import test from "node:test";
import assert from "node:assert/strict";
import { idf, termScore, fieldTermScore, DEFAULT_K1, DEFAULT_B } from "../src/bm25.js";

test("idf decreases as a term appears in more documents", () => {
  assert.ok(idf(1, 100) > idf(10, 100));
  assert.ok(idf(10, 100) > idf(90, 100));
  assert.ok(idf(90, 100) > 0);
  assert.equal(idf(0, 100), idf(0, 100));
  assert.equal(idf(5, 0), 0);
});

test("term frequency saturates instead of scoring linearly", () => {
  const base = { fieldLength: 50, avgFieldLength: 50, df: 10, N: 100 };
  const one = termScore({ ...base, tf: 1 });
  const two = termScore({ ...base, tf: 2 });
  const ten = termScore({ ...base, tf: 10 });
  assert.ok(one < two && two < ten);
  // Going from 9 to 10 hits adds much less than going from 1 to 2.
  assert.ok(ten - termScore({ ...base, tf: 9 }) < two - one);
});

test("the b parameter penalises long fields, and b=0 removes the penalty", () => {
  const kwargs = { tf: 2, df: 4, N: 20, k1: DEFAULT_K1 };
  const withPenalty = termScore({ ...kwargs, fieldLength: 200, avgFieldLength: 50, b: DEFAULT_B });
  const withoutPenalty = termScore({ ...kwargs, fieldLength: 200, avgFieldLength: 50, b: 0 });
  assert.ok(withPenalty < withoutPenalty);
});

test("fieldTermScore sums weighted field contributions and reports them", () => {
  const result = fieldTermScore({
    df: 5,
    N: 50,
    k1: DEFAULT_K1,
    b: DEFAULT_B,
    fields: [
      { name: "title", tf: 2, length: 6, avgLength: 6, weight: 2.5 },
      { name: "body", tf: 1, length: 60, avgLength: 40, weight: 1 },
    ],
  });
  assert.equal(result.parts.length, 2);
  assert.ok(Math.abs(result.score - result.parts.reduce((sum, part) => sum + part.score, 0)) < 1e-12);
  assert.ok(result.parts[0].score > 0 && result.parts[1].score > 0);
});
