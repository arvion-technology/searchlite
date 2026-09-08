<div align="center">
<img src="docs/demo.gif" alt="SearchLite demo: results, facets and a BM25 score breakdown" width="100%" />
</div>

<sub>Recorded from the live demo — <a href="docs/demo.mp4">MP4</a> · <a href="docs/screenshot.png">static frame</a></sub>

# SearchLite

An embeddable full-text search engine in plain JavaScript. Porter stemming, a
positional inverted index, BM25 ranking with configurable `k1` and `b`, phrase,
prefix and fuzzy queries, facets, synonyms and highlighted snippets — a few
modules instead of a search cluster.

[**Open the live demo**](https://arvion-technology.github.io/labs/demos/searchlite/demo/) · [MIT](LICENSE)

---

Search is one of those features that starts as a `LIKE '%term%'` query and becomes
a product problem six months later. SearchLite is the middle step: a real index
with positions and a ranking function you can inspect, small enough to read in an
afternoon. The demo indexes 60 documents in the browser and shows the score of
every term, so a surprising result can be explained rather than guessed at.

The relevance lab is the part worth opening. Drag `b` to zero and the same query
reranks; open any result and each query term's contribution — tf, df, idf, field
weight — is listed, and the breakdown is asserted in the tests to sum to the
document score.

## What it does

- **Porter stemmer** — the original 1980 algorithm, tested against the published
  vocabulary sample (`caresses → caress`, `relational → relat`, and so on).
- **Positional inverted index** — three fields (title, tags, body) with one
  posting per term-document pair and the token positions in that field.
- **BM25** — configurable `k1` (term-frequency saturation) and `b` (length
  normalisation), with per-field weights.
- **Query syntax** — plain terms are AND-ed, `"exact phrase"` checks adjacency,
  `retr*` expands a prefix, `jitter~1` expands by edit distance.
- **Facets and filters** — category, tag and year counts computed for the current
  match set; filters narrow it without changing the counts you use to decide.
- **Synonyms and stopwords** — synonyms add recall at a lower weight; stopwords
  are dropped from queries but kept in the index so phrase positions stay true.
- **Highlighted snippets** — returned as segments, not HTML, so the demo renders
  text nodes and `<mark>` elements and a document containing markup stays text.
- **Benchmark harness** — `npm run bench` reports index size, build time and
  p50/p95 query latency for seven query shapes.

## Screenshots

| Search index query | Prefix query (`retr*`) |
| --- | --- |
| ![Search results with score breakdown](docs/screenshot.png) | ![Prefix expansion](docs/screenshot-2.png) |

## Architecture

```
demo/app.js
   │  SearchIndex.search(query, { k1, b, filters })
   ▼
src/index.js ──────────────┐
   │  analyze(text)        │  build: documents → fieldIndex / df / lengths
   ▼                       │
src/tokenizer.js ──► src/porter.js
   │  parseQuery()         │
   ▼                       │
src/bm25.js  ◄─────────────┘  score(tf, len, avgLen, df, N, k1, b)
   │
   ▼
src/highlighter.js  ──►  segments for title/snippet (no HTML strings)
```

The demo builds one `SearchIndex` at startup from `src/documents.js` and runs every
search against it in the page. The tests construct the same class over a smaller
fixture corpus so scoring can be checked by hand.

The data model is intentionally plain:

```js
{
  id: "doc-01",
  title: "Exponential backoff with jitter",
  category: "engineering",
  tags: ["retries", "reliability", "queue"],
  body: "When a downstream service fails ...",
  year: 2024
}
```

The index stores, per field, `Map<term, Map<docId, positions[]>>` plus a global
document-frequency table and per-field lengths. That is enough for ranking and for
phrase adjacency, and small enough to debug by printing it.

## Quickstart

```bash
git clone https://github.com/arvion-technology/searchlite.git
cd searchlite
npm test          # 34 tests, no dependencies
npm run demo      # demo on http://localhost:4173
npm run bench     # index size and query latency
```

Use it as a library:

```js
import { SearchIndex } from "./src/index.js";

const index = new SearchIndex(documents, {
  synonyms: { retry: ["retries", "backoff"] },
  fieldWeights: { title: 3, tags: 1.5, body: 1 },
});

const result = index.search('"exponential backoff"', { k1: 1.2, b: 0.75, limit: 10 });
for (const hit of result.results) {
  console.log(hit.doc.title, hit.score.toFixed(2));
  console.log(hit.breakdown); // per-term tf, df, idf and score
}
```

## How it works

**Scoring is field-weighted BM25.** For each query term and each field it appears
in, the score is

```text
idf(term) * tf * (k1 + 1) / (tf + k1 * (1 - b + b * fieldLength / avgFieldLength))
```

multiplied by the field weight (title 2.5, tags 1.5, body 1). `idf` uses the
smoothed `ln(1 + (N - df + 0.5) / (df + 0.5))` form so a term that appears in every
document still has a small positive weight. The total for a document is the sum of
all term contributions; the demo prints exactly those contributions.

**Phrase queries are adjacency checks, not substring scans.** Each term's posting
list stores token positions, so `"exponential backoff"` matches a document when
`positions[backoff]` contains `positions[exponential] + 1` in the same field. That
is also why the analyzer keeps stopwords in the index: dropping `the` at index time
would shift every later position and make phrase queries approximate.

**Prefix and fuzzy queries expand over the vocabulary.** `retr*` selects indexed
terms starting with that prefix and scores documents containing any of them;
`jitter~1` selects terms within a Levenshtein distance of one, ordered by distance.
Both are capped — 24 expansions — because an unbounded expansion on a large
vocabulary is a denial-of-service path, not a feature.

**Facets are counts before their own filter.** The match set is computed first,
then category/tag/year counts are derived from it. Applying the category filter
afterwards narrows the results, but the counts you see are what each option would
give you, which is how a user decides whether to click it.

**Highlighting returns segments.** `segmentText("a <script> tag", matchers)` yields
`[{text, match}]`; the demo builds `document.createTextNode` and `<mark>` elements.
There is no HTML string to escape and no path where document content becomes
markup.

## Tests

```bash
npm test
```

34 tests on `node:test`:

- `porter.test.js` — 60+ published stemmer pairs, measure and vowel detection,
  short/non-alpha pass-through.
- `tokenizer.test.js` — unicode tokenisation, positions, stopwords, query parsing
  for terms/phrases/prefixes/fuzzy, edit distance.
- `bm25.test.js` — idf monotonicity, tf saturation, length penalty and `b=0`,
  field-weighted contribution sums.
- `index.test.js` — corpus stats, title boost, phrase adjacency, prefix/fuzzy
  expansion, synonyms, facets/filters, exact score-breakdown sums, k1/b effects,
  empty queries and no-match behaviour.
- `highlighter.test.js` — whole-token marks, prefix marks, snippet windows and
  clipping flags, markup stays plain text.

## Limitations

- **No incremental indexing.** `SearchIndex` is built once from an array; adding a
  document means rebuilding. Fine for a page or a small tool, not for a live
  corpus.
- **No persistence.** The index is in memory and rebuilt on each load. Serialising
  the posting maps is straightforward, but not implemented here.
- **No boolean syntax.** Terms are AND-ed; there is no `OR`, `NOT` or field query.
  Adding it is a parser change plus set operations, but it would double the query
  surface to document.
- **English-only analysis.** The tokenizer is unicode-aware, but the Porter
  stemmer and stopword list are English. Nepali or mixed-script text tokenises but
  is not stemmed.
- **Fuzzy expansion is a linear vocabulary scan.** It is bounded and fine for a few
  thousand terms. At scale it needs an n-gram index or a Levenshtein automaton.
- **Phrase queries ignore stopwords inside the phrase.** `"the quick brown"` drops
  `the` and then checks whether `quick` and `brown` are adjacent — which can match
  text where they are one word apart. Kept because it is cheap; documented because
  it is surprising.
- **60 documents is a demo corpus.** The ranking code is the same code used on a
  larger corpus, but relevance tuning at scale needs a labelled query set.

## Project layout

```
src/
  documents.js   60-document demo corpus (six categories)
  porter.js      Porter stemmer, measure/VC helpers
  tokenizer.js   tokenize, analyze, parseQuery, editDistance, stopwords
  index.js       positional index, query evaluation, facets, score breakdown
  bm25.js        idf and BM25 term/field scoring
  highlighter.js segments and snippets without HTML strings
demo/            three-pane search UI; imports src/index.js
scripts/bench.mjs benchmark harness
test/            node:test suites
```

## Credits

Built by [Arvion Technologies](https://arviontech.net) in Kathmandu. MIT licensed.
