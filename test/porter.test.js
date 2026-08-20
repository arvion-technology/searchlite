import test from "node:test";
import assert from "node:assert/strict";
import { porterStem, measure, containsVowel, stemAll } from "../src/porter.js";

// Pairs from the Porter stemmer's published vocabulary/output sample.
const VOCABULARY = [
  ["caresses", "caress"], ["ponies", "poni"], ["ties", "ti"], ["caress", "caress"],
  ["cats", "cat"], ["feed", "feed"], ["agreed", "agre"], ["plastered", "plaster"],
  ["bled", "bled"], ["motoring", "motor"], ["sing", "sing"], ["conflated", "conflat"],
  ["troubled", "troubl"], ["sized", "size"], ["hopping", "hop"], ["tanned", "tan"],
  ["falling", "fall"], ["hissing", "hiss"], ["fizzed", "fizz"], ["failing", "fail"],
  ["filing", "file"], ["happy", "happi"], ["sky", "sky"],
  ["relational", "relat"], ["conditional", "condit"], ["rational", "ration"],
  ["valenci", "valenc"], ["hesitanci", "hesit"], ["digitizer", "digit"],
  ["conformabli", "conform"], ["radicalli", "radic"], ["differentli", "differ"],
  ["vileli", "vile"], ["analogousli", "analog"], ["vietnamization", "vietnam"],
  ["predication", "predic"], ["operator", "oper"], ["feudalism", "feudal"],
  ["decisiveness", "decis"], ["hopefulness", "hope"], ["callousness", "callous"],
  ["formaliti", "formal"], ["sensitiviti", "sensit"], ["sensibiliti", "sensibl"],
  ["triplicate", "triplic"], ["formative", "form"], ["formalize", "formal"],
  ["electriciti", "electr"], ["electrical", "electr"], ["hopeful", "hope"],
  ["goodness", "good"], ["revival", "reviv"], ["allowance", "allow"],
  ["inference", "infer"], ["airliner", "airlin"], ["gyroscopic", "gyroscop"],
  ["adjustable", "adjust"], ["defensible", "defens"], ["irritant", "irrit"],
  ["replacement", "replac"], ["adjustment", "adjust"], ["dependent", "depend"],
  ["adoption", "adopt"], ["homologou", "homolog"], ["communism", "commun"],
  ["activate", "activ"], ["angulariti", "angular"], ["homologous", "homolog"],
  ["effective", "effect"], ["bowdlerize", "bowdler"],
];

test("the Porter stemmer matches the published vocabulary sample", () => {
  const failures = [];
  for (const [word, expected] of VOCABULARY) {
    const actual = porterStem(word);
    if (actual !== expected) failures.push(`${word}: expected ${expected}, got ${actual}`);
  }
  assert.deepEqual(failures, []);
});

test("measure counts vowel-consonant sequences", () => {
  assert.equal(measure("tr"), 0);
  assert.equal(measure("ee"), 0);
  assert.equal(measure("tree"), 0);
  assert.equal(measure("y"), 0);
  assert.equal(measure("by"), 0);
  assert.equal(measure("trouble"), 1);
  assert.equal(measure("oats"), 1);
  assert.equal(measure("trees"), 1);
  assert.equal(measure("ivy"), 1);
  assert.equal(measure("troubles"), 2);
  assert.equal(measure("private"), 2);
  assert.equal(measure("oaten"), 2);
  assert.equal(measure("orrery"), 2);
});

test("containsVowel treats y by position", () => {
  assert.equal(containsVowel("sky"), true); // s, k, y-as-vowel
  assert.equal(containsVowel("by"), true);
  assert.equal(containsVowel("tr"), false);
  assert.equal(containsVowel("yy"), true);
});

test("short words and non-alpha input pass through untouched", () => {
  assert.equal(porterStem("is"), "is");
  assert.equal(porterStem("go"), "go");
  assert.equal(porterStem("v2"), "v2");
  assert.equal(porterStem(""), "");
});

test("stemAll lowercases before stemming", () => {
  assert.deepEqual(stemAll(["Cats", "RUNNING", "Filing"]), ["cat", "run", "file"]);
});
