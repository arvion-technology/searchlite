// Positional inverted index + query evaluation.
//
// One index per field (title, tags, body) with a global document-frequency table.
// Term frequency is stored as the list of token positions, so a phrase query is
// an adjacency check on those lists rather than a substring scan. Postings are
// `Map<term, Map<docId, positions[]>>`; at this corpus size a sorted array would
// only add complexity.

import { analyze, parseQuery, DEFAULT_STOPWORDS, editDistance } from "./tokenizer.js";
import { termScore, idf, DEFAULT_K1, DEFAULT_B } from "./bm25.js";
import { segmentText, snippet, matchersForClauses } from "./highlighter.js";
import { porterStem } from "./porter.js";

export const FIELD_WEIGHTS = Object.freeze({ title: 2.5, tags: 1.5, body: 1 });
export const DEFAULT_FIELDS = Object.freeze(["title", "tags", "body"]);
const MAX_EXPANSIONS = 24;

export class SearchIndex {
  constructor(documents, {
    fields = DEFAULT_FIELDS,
    fieldWeights = FIELD_WEIGHTS,
    stopwords = DEFAULT_STOPWORDS,
    stem = true,
    synonyms = {},
  } = {}) {
    this.documents = documents.map((doc, index) => ({ ...doc, position: index }));
    this.fields = [...fields];
    this.fieldWeights = { ...FIELD_WEIGHTS, ...fieldWeights };
    this.stopwords = stopwords;
    this.stem = stem;
    this.synonyms = buildSynonyms(synonyms, stem);
    this.fieldIndex = Object.fromEntries(this.fields.map((field) => [field, new Map()]));
    this.docLengths = Object.fromEntries(this.fields.map((field) => [field, []]));
    this.avgLengths = {};
    this.df = new Map();
    this.vocabulary = new Set();
    this.postingCount = 0;
    this.positionCount = 0;
    const started = Date.now();
    this.#build();
    this.buildMs = Date.now() - started;
  }

  #fieldText(doc, field) {
    if (field === "tags") return (doc.tags ?? []).join(" ");
    return String(doc[field] ?? "");
  }

  #build() {
    for (const field of this.fields) {
      const postings = this.fieldIndex[field];
      const lengths = this.docLengths[field];
      this.documents.forEach((doc, docId) => {
        const tokens = analyze(this.#fieldText(doc, field), { stopwords: this.stopwords, stem: this.stem });
        lengths[docId] = tokens.length;
        for (const token of tokens) {
          let termPostings = postings.get(token.term);
          if (!termPostings) {
            termPostings = new Map();
            postings.set(token.term, termPostings);
            this.vocabulary.add(token.term);
          }
          let positions = termPostings.get(docId);
          if (!positions) {
            positions = [];
            termPostings.set(docId, positions);
            this.postingCount++;
          }
          positions.push(token.position);
          this.positionCount++;
          let docs = this.df.get(token.term);
          if (!docs) { docs = new Set(); this.df.set(token.term, docs); }
          docs.add(docId);
        }
      });
    }
    for (const field of this.fields) {
      const lengths = this.docLengths[field];
      const total = lengths.reduce((sum, length) => sum + length, 0);
      this.avgLengths[field] = lengths.length ? total / lengths.length : 0;
    }
  }

  get stats() {
    const termBytes = [...this.vocabulary].reduce((sum, term) => sum + term.length + 8, 0);
    return {
      documents: this.documents.length,
      fields: this.fields.length,
      terms: this.vocabulary.size,
      postings: this.postingCount,
      positions: this.positionCount,
      avgFieldLengths: Object.fromEntries(this.fields.map((field) => [field, Number(this.avgLengths[field].toFixed(1))])),
      estimatedBytes: termBytes + this.positionCount * 4 + this.postingCount * 16,
      buildMs: this.buildMs,
    };
  }

  /** Terms starting with `prefix`, longest-first is not useful here; alphabetical is stable. */
  expandPrefix(prefix, limit = MAX_EXPANSIONS) {
    if (!prefix) return [];
    const out = [];
    for (const term of this.vocabulary) {
      if (term.startsWith(prefix)) out.push(term);
      if (out.length >= limit * 4) break;
    }
    return out.sort((a, b) => a.length - b.length || a.localeCompare(b)).slice(0, limit);
  }

  expandFuzzy(term, distance = 1, limit = MAX_EXPANSIONS) {
    const out = [];
    for (const candidate of this.vocabulary) {
      const d = editDistance(term, candidate);
      if (d <= distance) out.push({ term: candidate, distance: d });
    }
    return out.sort((a, b) => a.distance - b.distance || a.term.localeCompare(b.term)).slice(0, limit);
  }

  #expandClause(clause) {
    if (clause.type === "phrase") {
      return {
        clause,
        terms: clause.terms.map((term) => ({ term, weight: 1, source: "phrase", display: term })),
      };
    }
    if (clause.type === "prefix") {
      const terms = this.expandPrefix(clause.term);
      return {
        clause,
        terms: terms.map((term) => ({ term, weight: 1, source: "prefix", display: term })),
        expansionCount: terms.length,
      };
    }
    if (clause.type === "fuzzy") {
      const terms = this.expandFuzzy(clause.term, clause.distance);
      return {
        clause,
        terms: terms.map((entry) => ({ term: entry.term, weight: 1, source: "fuzzy", display: entry.term, distance: entry.distance })),
        expansionCount: terms.length,
      };
    }
    const main = { term: clause.term, weight: 1, source: "term", display: clause.term };
    const extra = (this.synonyms.get(clause.term) ?? [])
      .filter((term) => term !== clause.term)
      .map((term) => ({ term, weight: 0.7, source: "synonym", display: term }));
    return { clause, terms: [main, ...extra] };
  }

  /** Map docId → { score, entries } for one clause. */
  #scoreGroup(group, { k1 = DEFAULT_K1, b = DEFAULT_B } = {}) {
    if (group.clause.type === "phrase") return this.#scorePhrase(group, { k1, b });
    const perDoc = new Map();
    for (const term of group.terms) {
      const df = this.df.get(term.term)?.size ?? 0;
      if (!df) continue;
      const termIdf = idf(df, this.documents.length);
      for (const field of this.fields) {
        const postings = this.fieldIndex[field].get(term.term);
        if (!postings) continue;
        const weight = this.fieldWeights[field] * term.weight;
        for (const [docId, positions] of postings) {
          const tf = positions.length;
          const score = termScore({
            tf,
            fieldLength: this.docLengths[field][docId],
            avgFieldLength: this.avgLengths[field],
            df,
            N: this.documents.length,
            k1,
            b,
          }) * weight;
          let entry = perDoc.get(docId);
          if (!entry) { entry = { score: 0, entries: [] }; perDoc.set(docId, entry); }
          entry.score += score;
          const existing = entry.entries.find((item) => item.term === term.display && item.source === term.source);
          if (existing) {
            existing.tf += tf;
            existing.score += score;
          } else {
            entry.entries.push({
              term: term.display,
              source: term.source,
              weight: term.weight,
              tf,
              df,
              idf: Number(termIdf.toFixed(4)),
              score,
            });
          }
        }
      }
    }
    return perDoc;
  }

  #scorePhrase(group, { k1, b }) {
    const { terms } = group;
    const termDocs = terms.map((term) => this.df.get(term.term) ?? new Set());
    if (termDocs.some((docs) => docs.size === 0)) return new Map();
    let candidateDocs = new Set(termDocs[0]);
    for (let i = 1; i < termDocs.length; i++) {
      candidateDocs = new Set([...candidateDocs].filter((docId) => termDocs[i].has(docId)));
      if (!candidateDocs.size) return new Map();
    }

    const perDoc = new Map();
    for (const docId of candidateDocs) {
      let occurrences = 0;
      const termTotals = new Array(terms.length).fill(0);
      for (const field of this.fields) {
        const lists = terms.map((term) => this.fieldIndex[field].get(term.term)?.get(docId) ?? []);
        if (!lists.every((positions) => positions.length > 0)) continue;
        const lookup = lists.map((positions) => new Set(positions));
        let fieldOccurrences = 0;
        for (const start of lists[0]) {
          let adjacent = true;
          for (let offset = 1; offset < lists.length; offset++) {
            if (!lookup[offset].has(start + offset)) { adjacent = false; break; }
          }
          if (adjacent) fieldOccurrences++;
        }
        if (!fieldOccurrences) continue;
        occurrences += fieldOccurrences;
        for (let i = 0; i < terms.length; i++) {
          termTotals[i] += termScore({
            tf: lists[i].length,
            fieldLength: this.docLengths[field][docId],
            avgFieldLength: this.avgLengths[field],
            df: this.df.get(terms[i].term).size,
            N: this.documents.length,
            k1,
            b,
          }) * this.fieldWeights[field];
        }
      }
      if (!occurrences) continue;

      // Entries must sum to the document score exactly, otherwise the demo's
      // "score breakdown" panel would be a lie.
      const phraseBonus = occurrences * 2;
      const entries = terms.map((term, index) => {
        const df = this.df.get(term.term).size;
        return {
          term: term.display,
          source: "phrase",
          weight: 1,
          tf: occurrences,
          df,
          idf: Number(idf(df, this.documents.length).toFixed(4)),
          score: termTotals[index],
        };
      });
      entries.push({
        term: `"${group.clause.text}"`,
        source: "phrase-boost",
        weight: 1,
        tf: occurrences,
        df: candidateDocs.size,
        idf: 0,
        score: phraseBonus,
      });
      const score = entries.reduce((sum, entry) => sum + entry.score, 0);
      perDoc.set(docId, { score, entries });
    }
    return perDoc;
  }

  #facetCounts(docIds) {
    const counts = { category: new Map(), tags: new Map(), year: new Map() };
    for (const docId of docIds) {
      const doc = this.documents[docId];
      bump(counts.category, doc.category);
      bump(counts.year, String(doc.year));
      for (const tag of doc.tags ?? []) bump(counts.tags, tag);
    }
    const rank = (a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]));
    return {
      category: [...counts.category].sort(rank).map(([value, count]) => ({ value, count })),
      tags: [...counts.tags].sort(rank).slice(0, 12).map(([value, count]) => ({ value, count })),
      year: [...counts.year].sort((a, b) => Number(b[0]) - Number(a[0])).map(([value, count]) => ({ value, count })),
    };
  }

  /**
   * Search. Terms are AND-ed; a phrase is one clause. Facet counts are computed
   * before facet filters are applied so every option shows what it would do.
   */
  search(query, {
    limit = 10,
    k1 = DEFAULT_K1,
    b = DEFAULT_B,
    filters = {},
    highlight = true,
  } = {}) {
    const started = Date.now();
    const clauses = parseQuery(query ?? "", { stopwords: this.stopwords, stem: this.stem });
    const groups = clauses.map((clause) => this.#expandClause(clause));
    const maps = groups.map((group) => this.#scoreGroup(group, { k1, b }));

    let docIds;
    if (!groups.length) {
      docIds = new Set(this.documents.map((doc) => doc.position));
    } else {
      docIds = new Set();
      for (const map of maps) {
        if (!map.size) { docIds = new Set(); break; }
        for (const docId of map.keys()) docIds.add(docId);
      }
      for (const map of maps) for (const docId of [...docIds]) if (!map.has(docId)) docIds.delete(docId);
    }

    const facetCounts = this.#facetCounts([...docIds]);
    const matchers = highlight ? matchersForClauses(clauses) : [];
    const matched = [];

    for (const docId of docIds) {
      const doc = this.documents[docId];
      if (!matchesFilters(doc, filters)) continue;
      const breakdown = [];
      let score = 0;
      maps.forEach((map, groupIndex) => {
        const entry = map.get(docId);
        if (!entry) return;
        score += entry.score;
        const clause = groups[groupIndex].clause;
        for (const item of entry.entries) breakdown.push({ ...item, clause: clause.type });
      });
      matched.push({
        doc: publicDoc(doc),
        score,
        breakdown,
        titleSegments: highlight ? segmentText(doc.title, matchers) : [{ text: doc.title, match: false }],
        snippet: highlight ? snippet(doc.body, matchers, { words: 34, before: 8 }) : { text: doc.body, segments: [], clippedStart: false, clippedEnd: false },
      });
    }

    matched.sort((a, b2) => b2.score - a.score || a.doc.id.localeCompare(b2.doc.id));
    return {
      query: query ?? "",
      clauses,
      results: matched.slice(0, limit),
      total: matched.length,
      facetCounts,
      stats: this.stats,
      k1,
      b,
      tookMs: Date.now() - started,
    };
  }
}

function bump(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function matchesFilters(doc, filters) {
  const category = filters.category ?? [];
  const tags = filters.tags ?? [];
  const years = filters.year ?? [];
  if (category.length && !category.includes(doc.category)) return false;
  if (years.length && !years.includes(String(doc.year))) return false;
  if (tags.length) {
    const set = new Set(doc.tags ?? []);
    if (!tags.some((tag) => set.has(tag))) return false;
  }
  return true;
}

function publicDoc(doc) {
  const { position, ...rest } = doc;
  return rest;
}

function buildSynonyms(raw, stem) {
  const map = new Map();
  const normalise = (word) => (stem ? porterStem(String(word).toLowerCase()) : String(word).toLowerCase());
  for (const [key, values] of Object.entries(raw)) {
    const term = normalise(key);
    const expanded = new Set((Array.isArray(values) ? values : [values]).map(normalise));
    expanded.delete(term);
    if (!map.has(term)) map.set(term, []);
    map.get(term).push(...expanded);
  }
  return map;
}
