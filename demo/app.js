// SearchLite demo.
//
// The index, tokenizer, stemmer and BM25 scorer are the modules under ../src;
// this file only renders results and lets you change k1/b and facet filters.
import { SearchIndex } from "../src/index.js";
import { DOCUMENTS } from "../src/documents.js";

const $ = A.$, el = A.el, fmt = A.fmt;

const index = new SearchIndex(DOCUMENTS, {
  synonyms: {
    retry: ["retries", "backoff"],
    kubernetes: ["k8s"],
    postgres: ["postgresql"],
    observability: ["metrics", "tracing"],
  },
});

const state = {
  query: "search index",
  filters: { category: [], tags: [], year: [] },
  k1: 1.2,
  b: 0.75,
  limit: 10,
  selectedId: null,
  result: null,
};

/* ------------------------------------------------------------------ pieces */

function segmentsNode(segments) {
  return el("span", {}, ...segments.map((segment) =>
    segment.match ? el("mark", { text: segment.text }) : document.createTextNode(segment.text)));
}

function badge(text, tone = "") {
  return el("span", { class: `badge ${tone}`, text });
}

function renderFacets(result) {
  const counts = result.facetCounts;
  const active = state.filters;

  $("#facet-category").replaceChildren(...counts.category.map((entry) =>
    el("div", {
      class: `facet ${active.category.includes(entry.value) ? "on" : ""}`,
      role: "button", tabindex: "0",
      onclick: () => toggleFilter("category", entry.value),
      onkeydown: (event) => { if (event.key === "Enter") toggleFilter("category", entry.value); },
    },
      el("span", { class: "tick", text: "✓" }),
      el("span", { text: fmt.title(entry.value) }),
      el("span", { class: "n", text: String(entry.count) }))));

  const tagCounts = new Map(counts.tags.map((entry) => [entry.value, entry.count]));
  for (const tag of active.tags) if (!tagCounts.has(tag)) tagCounts.set(tag, 0);
  $("#facet-tags").replaceChildren(...[...tagCounts].slice(0, 16).map(([tag, count]) =>
    el("span", {
      class: `tag-chip ${active.tags.includes(tag) ? "on" : ""}`,
      role: "button", tabindex: "0",
      onclick: () => toggleFilter("tags", tag),
      onkeydown: (event) => { if (event.key === "Enter") toggleFilter("tags", tag); },
    },
      document.createTextNode(tag),
      el("span", { class: "n", text: String(count) }))));

  $("#facet-year").replaceChildren(...counts.year.map((entry) =>
    el("span", {
      class: `tag-chip ${active.year.includes(entry.value) ? "on" : ""}`,
      role: "button", tabindex: "0",
      onclick: () => toggleFilter("year", entry.value),
      onkeydown: (event) => { if (event.key === "Enter") toggleFilter("year", entry.value); },
    },
      document.createTextNode(entry.value),
      el("span", { class: "n", text: String(entry.count) }))));
}

function renderResults(result) {
  $("#result-title").textContent = state.query.trim() ? state.query : "All documents";
  const latency = result.tookMs < 1 ? "<1 ms" : `${result.tookMs} ms`;
  $("#result-meta").textContent = `${result.total} result${result.total === 1 ? "" : "s"} · ${latency}`;
  $("#latency").textContent = latency;

  if (!result.results.length) {
    $("#result-list").replaceChildren(el("div", { class: "card", style: "padding:26px;text-align:center" },
      el("div", { class: "card-title", text: "No documents matched" }),
      el("p", { class: "small muted", style: "margin:8px 0 0", text: "Try removing a filter, a term, or a phrase quote. Prefix and fuzzy syntax: retr* and jitter~1." })));
    return;
  }

  const cards = result.results.map((entry, position) => {
    const title = el("div", { class: "result-top" },
      el("span", { class: "result-title" }, segmentsNode(entry.titleSegments)),
      el("span", { class: "result-score", text: entry.score.toFixed(2) }));
    const meta = el("div", { class: "result-meta" },
      badge(fmt.title(entry.doc.category)),
      el("span", { text: String(entry.doc.year) }),
      el("span", { text: `· result ${position + 1}` }),
      el("span", { class: "spacer" }),
      el("span", { text: `${entry.breakdown.length} score term${entry.breakdown.length === 1 ? "" : "s"}` }));
    const body = el("div", { class: "result-snippet" },
      entry.snippet.clippedStart ? el("span", { class: "ellipsis", text: "… " }) : null,
      segmentsNode(entry.snippet.segments),
      entry.snippet.clippedEnd ? el("span", { class: "ellipsis", text: " …" }) : null);
    const tags = el("div", { class: "result-tags" },
      ...entry.doc.tags.slice(0, 4).map((tag) => badge(tag)));
    return el("div", {
      class: `result ${entry.doc.id === state.selectedId ? "selected" : ""}`,
      role: "button", tabindex: "0",
      onclick: () => select(entry.doc.id),
      onkeydown: (event) => { if (event.key === "Enter") select(entry.doc.id); },
    }, title, meta, body, tags);
  });
  $("#result-list").replaceChildren(...cards);
}

function renderLab(result) {
  const selected = result.results.find((entry) => entry.doc.id === state.selectedId) ?? null;
  $("#lab-empty").hidden = Boolean(selected);
  $("#lab-body").hidden = !selected;
  if (!selected) return;

  $("#lab-title").textContent = selected.doc.title;
  $("#lab-meta").textContent = `${fmt.title(selected.doc.category)} · ${selected.doc.year} · ${selected.doc.tags.join(", ")}`;
  $("#lab-score").textContent = selected.score.toFixed(2);
  $("#lab-rank").textContent = `#${result.results.indexOf(selected) + 1} of ${result.total}`;

  const max = Math.max(...selected.breakdown.map((entry) => entry.score), 0.0001);
  $("#score-breakdown").replaceChildren(...selected.breakdown.map((entry) =>
    el("div", { class: "term-row" },
      el("div", { class: "term-top" },
        el("span", { class: "term-name", text: entry.term }),
        el("span", { class: `term-source ${entry.source}`, text: entry.source }),
        el("span", { class: "term-score", text: entry.score.toFixed(3) })),
      el("div", { class: "term-bar" }, el("i", { style: `width:${Math.max(1, (entry.score / max) * 100)}%` })),
      el("div", { class: "term-stats" },
        el("span", { text: `tf ${entry.tf}` }),
        el("span", { text: `df ${entry.df}` }),
        el("span", { text: `idf ${entry.idf.toFixed(2)}` }),
        el("span", { text: `weight ${entry.weight}` })))));

  const sum = selected.breakdown.reduce((total, entry) => total + entry.score, 0);
  $("#breakdown-sum").textContent = sum.toFixed(2);
}

function renderStats() {
  const stats = index.stats;
  $("#stat-docs").textContent = fmt.num(stats.documents);
  $("#stat-terms").textContent = fmt.num(stats.terms);
  $("#stat-postings").textContent = fmt.num(stats.postings);
  $("#stat-positions").textContent = fmt.num(stats.positions);
  $("#stat-bytes").textContent = fmt.bytes(stats.estimatedBytes);
  $("#stat-build").textContent = `${stats.buildMs} ms`;
  $("#index-badge").textContent = `${stats.documents} docs · ${fmt.bytes(stats.estimatedBytes)}`;
}

/* ---------------------------------------------------------------- actions */

function toggleFilter(facet, value) {
  const list = state.filters[facet];
  const position = list.indexOf(value);
  if (position === -1) list.push(value);
  else list.splice(position, 1);
  update();
}

function select(id) {
  state.selectedId = id;
  renderResults(state.result);
  renderLab(state.result);
}

function runSearch({ keepSelection = true } = {}) {
  const previous = state.selectedId;
  state.result = index.search(state.query, {
    limit: state.limit,
    k1: state.k1,
    b: state.b,
    filters: state.filters,
  });
  if (keepSelection && previous && state.result.results.some((entry) => entry.doc.id === previous)) {
    state.selectedId = previous;
  } else {
    state.selectedId = state.result.results[0]?.doc.id ?? null;
  }
}

function update({ keepSelection = true } = {}) {
  runSearch({ keepSelection });
  renderFacets(state.result);
  renderResults(state.result);
  renderLab(state.result);
  writeHash();
}

/* ------------------------------------------------------------------ hash */

function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  const query = params.get("q");
  if (query !== null) state.query = query;
  for (const facet of ["category", "tags", "year"]) {
    const value = params.get(facet);
    if (value) state.filters[facet] = value.split(",").filter(Boolean);
  }
}

function writeHash() {
  const params = new URLSearchParams();
  if (state.query) params.set("q", state.query);
  for (const facet of ["category", "tags", "year"]) {
    if (state.filters[facet].length) params.set(facet, state.filters[facet].join(","));
  }
  const next = `#${params.toString()}`;
  if (location.hash !== next) history.replaceState(null, "", next);
}

/* ------------------------------------------------------------------- wire */

function wire() {
  const input = $("#q");
  input.value = state.query;
  input.addEventListener("input", A.debounce(() => {
    state.query = input.value;
    update({ keepSelection: false });
  }, 140));

  $("#limit").addEventListener("change", (event) => {
    state.limit = Number(event.target.value);
    update();
  });

  $("#k1").addEventListener("input", (event) => {
    state.k1 = Number(event.target.value);
    $("#k1-value").textContent = state.k1.toFixed(1);
    runSearch();
    renderResults(state.result);
    renderLab(state.result);
  });
  $("#b").addEventListener("input", (event) => {
    state.b = Number(event.target.value);
    $("#b-value").textContent = state.b.toFixed(2);
    runSearch();
    renderResults(state.result);
    renderLab(state.result);
  });

  $("#clear-filters").addEventListener("click", () => {
    state.filters = { category: [], tags: [], year: [] };
    update();
  });

  document.querySelectorAll(".syntax").forEach((button) => {
    button.addEventListener("click", () => {
      state.query = button.dataset.query;
      $("#q").value = state.query;
      update({ keepSelection: false });
    });
  });

  window.addEventListener("hashchange", () => {
    readHash();
    $("#q").value = state.query;
    update({ keepSelection: false });
  });
}

readHash();
renderStats();
wire();
update({ keepSelection: false });
