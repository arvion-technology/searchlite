import test from "node:test";
import assert from "node:assert/strict";
import { SearchIndex } from "../src/index.js";
import { DOCUMENTS } from "../src/documents.js";

const synonyms = { retry: ["retries", "backoff"], kubernetes: ["k8s"], postgres: ["postgresql"] };
const index = new SearchIndex(DOCUMENTS, { synonyms });

const sumScores = (result) => result.breakdown.reduce((sum, entry) => sum + entry.score, 0);

test("the index reports honest corpus statistics", () => {
  const stats = index.stats;
  assert.equal(stats.documents, 60);
  assert.ok(stats.terms > 800, `expected a real vocabulary, got ${stats.terms}`);
  assert.ok(stats.postings > 2_000);
  assert.ok(stats.positions >= stats.postings);
  assert.ok(stats.avgFieldLengths.body > 20);
  assert.ok(stats.estimatedBytes > 0);
  assert.ok(stats.buildMs >= 0);
});

test("a title match outranks a body-only match", () => {
  const result = index.search("jitter", { limit: 5 });
  assert.equal(result.total, 1);
  assert.equal(result.results[0].doc.id, "doc-01");
  // "backoff" appears in several bodies; the one with it in the title wins.
  const backoff = index.search("backoff", { limit: 5 });
  assert.equal(backoff.results[0].doc.id, "doc-01");
});

test("phrase queries require adjacent positions", () => {
  const adjacent = index.search('"exponential backoff"', { limit: 3 });
  assert.equal(adjacent.total, 1);
  assert.equal(adjacent.results[0].doc.id, "doc-01");
  assert.equal(index.search('"backoff exponential"', { limit: 3 }).total, 0);
  // Words that appear in the same document but are not adjacent must not match.
  assert.equal(index.search('"jitter delay"', { limit: 3 }).total, 0);
});

test("prefix queries expand from the stemmed vocabulary", () => {
  assert.ok(index.expandPrefix("retr").length > 0);
  const prefix = index.search("kuber*", { limit: 5 });
  assert.equal(prefix.total, 1);
  assert.equal(prefix.results[0].doc.id, "doc-17");
  assert.equal(index.search("zzzz*").total, 0);
  assert.equal(index.search("retr*").total, index.search("retry").total);
});

test("fuzzy queries tolerate one edit and report the expansion", () => {
  const fuzzy = index.search("kubernets~1", { limit: 5 });
  assert.equal(fuzzy.total, 1);
  assert.equal(fuzzy.results[0].doc.id, "doc-17");
  assert.ok(fuzzy.results[0].breakdown.some((entry) => entry.source === "fuzzy"));
  assert.equal(index.search("qwerty~1").total, 0);
});

test("synonyms add recall and are marked in the breakdown", () => {
  const docs = [
    { id: "a", title: "Kubernetes deployments", category: "infra", tags: ["cluster"], body: "Rolling updates for pods.", year: 2025 },
    { id: "b", title: "Cooking rice", category: "life", tags: ["food"], body: "Wash the rice first.", year: 2024 },
  ];
  const withSynonyms = new SearchIndex(docs, { synonyms: { container: ["kubernetes"] } });
  const result = withSynonyms.search("container");
  assert.equal(result.total, 1);
  assert.equal(result.results[0].doc.id, "a");
  assert.ok(result.results[0].breakdown.some((entry) => entry.source === "synonym"));
  const without = new SearchIndex(docs);
  assert.equal(without.search("container").total, 0);
});

test("facet counts cover the match set and filters narrow it", () => {
  const result = index.search("queue", { limit: 20 });
  assert.ok(result.total > 3);
  const categoryTotal = result.facetCounts.category.reduce((sum, entry) => sum + entry.count, 0);
  assert.equal(categoryTotal, result.total);
  assert.ok(result.facetCounts.tags.length <= 12);

  const engineeringOnly = index.search("queue", { limit: 20, filters: { category: ["engineering"] } });
  assert.ok(engineeringOnly.total > 0);
  assert.ok(engineeringOnly.total < result.total);
  assert.ok(engineeringOnly.results.every((entry) => entry.doc.category === "engineering"));

  const tagged = index.search("bm25", { limit: 20, filters: { tags: ["bm25"] } });
  assert.ok(tagged.total > 0);
  assert.ok(tagged.results.every((entry) => entry.doc.tags.includes("bm25")));

  const yearValue = result.facetCounts.year[0].value;
  const year = index.search("queue", { limit: 20, filters: { year: [yearValue] } });
  assert.ok(year.total > 0);
  assert.ok(year.results.every((entry) => String(entry.doc.year) === yearValue));
  assert.equal(index.search("queue", { limit: 20, filters: { category: ["missing"] } }).total, 0);
});

test("the score breakdown adds up to the score for every result", () => {
  for (const query of ["retry", '"exponential backoff"', "retr*", "postgres backup"]) {
    for (const result of index.search(query, { limit: 10 }).results) {
      assert.ok(Math.abs(sumScores(result) - result.score) < 1e-9, `${query} / ${result.doc.id}`);
      assert.ok(result.breakdown.length > 0);
    }
  }
});

test("results are ordered by score, then stable by id", () => {
  const result = index.search("queue", { limit: 20 });
  for (let i = 1; i < result.results.length; i++) {
    assert.ok(result.results[i - 1].score >= result.results[i].score);
  }
  assert.equal(index.search("queue", { limit: 3 }).results.length, 3);
});

test("k1 and b change ranking inputs, which is why the lab exposes them", () => {
  const lowB = index.search("search", { limit: 5, b: 0 });
  const highB = index.search("search", { limit: 5, b: 1 });
  assert.notEqual(lowB.results[0].score, highB.results[0].score);
  const lowK = index.search("search", { limit: 5, k1: 0.2 });
  const highK = index.search("search", { limit: 5, k1: 3 });
  assert.notEqual(lowK.results[0].score, highK.results[0].score);
  assert.equal(lowK.results[0].doc.id, highK.results[0].doc.id);
});

test("an empty query browses the corpus, stopwords do not become clauses", () => {
  const browse = index.search("", { limit: 5 });
  assert.equal(browse.total, 60);
  assert.equal(browse.results.length, 5);
  assert.deepEqual(browse.clauses, []);
  assert.equal(index.search("the and of", { limit: 5 }).total, 60);
});

test("highlighting returns segments rather than an HTML string", () => {
  const result = index.search("jitter", { limit: 1 });
  const marked = result.results[0].snippet.segments.filter((segment) => segment.match).map((segment) => segment.text.toLowerCase());
  assert.ok(marked.includes("jitter"));
  assert.ok(result.results[0].titleSegments.some((segment) => segment.match));
});

test("a query with no matches still returns facet data for the empty set", () => {
  const result = index.search("unfindableterm");
  assert.equal(result.total, 0);
  assert.deepEqual(result.results, []);
  assert.deepEqual(result.facetCounts.category, []);
});
