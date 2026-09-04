#!/usr/bin/env node
// Benchmark harness. Builds the demo corpus, runs the shipped queries and
// reports wall-clock latency plus the index size the SearchIndex reports.
//
//   node scripts/bench.mjs [iterations]
import { SearchIndex } from "../src/index.js";
import { DOCUMENTS } from "../src/documents.js";

const iterations = Number(process.argv[2] || 500);
const queries = ["queue", "search index", '"exponential backoff"', "retr*", "jitter~1", "kubernets~1", "postgres backup"];

const buildStart = performance.now();
const index = new SearchIndex(DOCUMENTS, {
  synonyms: { retry: ["retries", "backoff"], kubernetes: ["k8s"], postgres: ["postgresql"] },
});
const buildMs = performance.now() - buildStart;
const stats = index.stats;

const samples = [];
for (const query of queries) {
  index.search(query, { limit: 10 }); // warm-up
  for (let i = 0; i < iterations; i++) {
    const started = performance.now();
    index.search(query, { limit: 10 });
    samples.push(performance.now() - started);
  }
}
samples.sort((a, b) => a - b);
const pct = (p) => samples[Math.min(samples.length - 1, Math.floor((p / 100) * samples.length))];

console.log(`documents      ${stats.documents}`);
console.log(`terms          ${stats.terms}`);
console.log(`postings       ${stats.postings}`);
console.log(`positions      ${stats.positions}`);
console.log(`index size     ${(stats.estimatedBytes / 1024).toFixed(1)} KB (estimated)`);
console.log(`build          ${buildMs.toFixed(2)} ms`);
console.log(`queries        ${queries.length} shapes × ${iterations} iterations`);
console.log(`latency        p50 ${pct(50).toFixed(3)} ms · p95 ${pct(95).toFixed(3)} ms · max ${samples[samples.length - 1].toFixed(3)} ms`);
