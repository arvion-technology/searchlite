// Porter stemmer (Porter, 1980). The original algorithm, not a "light" variant.
//
// Terms used below are Porter's: a *measure* m is the number of VC sequences in a
// word; a stem *contains a vowel* if it has at least one a/e/i/o/u (or a y acting
// as one). The step order matters, so the code follows the paper rather than a
// later rewrite that quietly changes the output.

const VOWELS = new Set(["a", "e", "i", "o", "u"]);

function isConsonant(word, i) {
  const ch = word[i];
  if (VOWELS.has(ch)) return false;
  if (ch === "y") return i === 0 ? true : !isConsonant(word, i - 1);
  return true;
}

/** Measure: number of vowel-consonant sequences in the stem. */
export function measure(stem) {
  let m = 0;
  let i = 0;
  const n = stem.length;
  while (i < n) {
    while (i < n && isConsonant(stem, i)) i++;
    if (i >= n) break;
    while (i < n && !isConsonant(stem, i)) i++;
    if (i >= n) break;
    m++;
  }
  return m;
}

export function containsVowel(stem) {
  for (let i = 0; i < stem.length; i++) if (!isConsonant(stem, i)) return true;
  return false;
}

function endsWith(word, suffix) {
  return word.endsWith(suffix);
}

function replaceSuffix(word, suffix, replacement) {
  return word.slice(0, word.length - suffix.length) + replacement;
}

/** Ends with a double consonant that is not l, s or z. */
function endsDoubleConsonant(word) {
  const n = word.length;
  if (n < 2) return false;
  return word[n - 1] === word[n - 2] && isConsonant(word, n - 1) && !["l", "s", "z"].includes(word[n - 1]);
}

/** Consonant-vowel-consonant where the final consonant is not w, x or y. */
function endsCvc(word) {
  const n = word.length;
  if (n < 3) return false;
  return isConsonant(word, n - 3) && !isConsonant(word, n - 2) && isConsonant(word, n - 1)
    && !["w", "x", "y"].includes(word[n - 1]);
}

function step2(word) {
  const rules = [
    ["ational", "ate"], ["tional", "tion"], ["enci", "ence"], ["anci", "ance"],
    ["izer", "ize"], ["bli", "ble"], ["alli", "al"], ["entli", "ent"], ["eli", "e"],
    ["ousli", "ous"], ["ization", "ize"], ["ation", "ate"], ["ator", "ate"],
    ["alism", "al"], ["iveness", "ive"], ["fulness", "ful"], ["ousness", "ous"],
    ["aliti", "al"], ["iviti", "ive"], ["biliti", "ble"], ["logi", "log"],
  ];
  for (const [suffix, replacement] of rules) {
    if (!endsWith(word, suffix)) continue;
    const stem = word.slice(0, word.length - suffix.length);
    return measure(stem) > 0 ? stem + replacement : word;
  }
  return word;
}

function step3(word) {
  const rules = [
    ["icate", "ic"], ["ative", ""], ["alize", "al"], ["iciti", "ic"],
    ["ical", "ic"], ["ful", ""], ["ness", ""],
  ];
  for (const [suffix, replacement] of rules) {
    if (!endsWith(word, suffix)) continue;
    const stem = word.slice(0, word.length - suffix.length);
    return measure(stem) > 0 ? stem + replacement : word;
  }
  return word;
}

function step4(word) {
  const suffixes = [
    "al", "ance", "ence", "er", "ic", "able", "ible", "ant", "ement", "ment",
    "ent", "ion", "ou", "ism", "ate", "iti", "ous", "ive", "ize",
  ];
  for (const suffix of suffixes) {
    if (!endsWith(word, suffix)) continue;
    const stem = word.slice(0, word.length - suffix.length);
    if (measure(stem) <= 1) return word;
    if (suffix === "ion" && !/[st]$/.test(stem)) return word;
    return stem;
  }
  return word;
}

/**
 * Stem one lowercase word. Non-alpha input is returned unchanged; the tokenizer
 * is responsible for deciding what reaches the stemmer at all.
 */
export function porterStem(word) {
  if (!/^[a-z]+$/.test(word) || word.length < 3) return word;
  let w = word;

  // Step 1a
  if (endsWith(w, "sses")) w = replaceSuffix(w, "sses", "ss");
  else if (endsWith(w, "ies")) w = replaceSuffix(w, "ies", "i");
  else if (endsWith(w, "ss")) { /* leave */ }
  else if (endsWith(w, "s")) {
    const stem = w.slice(0, -1);
    if (containsVowel(stem)) w = stem;
  }

  // Step 1b
  let step1bApplied = false;
  if (endsWith(w, "eed")) {
    const stem = w.slice(0, -3);
    if (measure(stem) > 0) w = stem + "ee";
  } else if (endsWith(w, "ed")) {
    const stem = w.slice(0, -2);
    if (containsVowel(stem)) { w = stem; step1bApplied = true; }
  } else if (endsWith(w, "ing")) {
    const stem = w.slice(0, -3);
    if (containsVowel(stem)) { w = stem; step1bApplied = true; }
  }
  if (step1bApplied) {
    if (endsWith(w, "at")) w = w + "e";
    else if (endsWith(w, "bl")) w = w + "e";
    else if (endsWith(w, "iz")) w = w + "e";
    else if (endsDoubleConsonant(w)) w = w.slice(0, -1);
    else if (measure(w) === 1 && endsCvc(w)) w = w + "e";
  }

  // Step 1c
  if (endsWith(w, "y")) {
    const stem = w.slice(0, -1);
    if (containsVowel(stem)) w = stem + "i";
  }

  w = step2(w);
  w = step3(w);
  w = step4(w);

  // Step 5a
  if (endsWith(w, "e")) {
    const stem = w.slice(0, -1);
    const m = measure(stem);
    if (m > 1 || (m === 1 && !endsCvc(stem))) w = stem;
  }
  // Step 5b
  if (measure(w) > 1 && endsWith(w, "ll")) w = w.slice(0, -1);

  return w;
}

/** Convenience for tests and the demo: map a list of words through the stemmer. */
export function stemAll(words) {
  return words.map((word) => porterStem(String(word).toLowerCase()));
}
