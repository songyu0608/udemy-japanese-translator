/*
 * Developer term dictionary.
 * Each row is a term with an optional Japanese meaning:
 * - A term without a meaning is kept in English: it is replaced with a [[n]]
 *   placeholder before translation and restored afterwards.
 * - A term with a meaning is replaced with that meaning instead of the word.
 * Rows come from dictionary.json (dictionary branch). The bundled list in
 * dictionary-terms.js is used when that file cannot be used.
 */
(() => {
  "use strict";

  const root = typeof window !== "undefined" ? window : globalThis;
  const bundled = root.__udemyQuizTranslatorTerms || {};

  // The translator sometimes adds a bracket ("[[[0]]"); absorb extras.
  const PLACEHOLDER = /\[*\[\[\s*(\d+)\s*\]\]\]*/g;

  function escapeTerm(term) {
    return term
      .trim()
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\s+/g, "\\s+");
  }

  // A plural suffix is allowed only after a letter ("instances", "VPCs").
  function termPattern(term) {
    const plural = /[A-Za-z]$/.test(term.trim()) ? "(?:e?s)?" : "";
    return `${escapeTerm(term)}${plural}`;
  }

  // Acronyms ("SAM", "LAG") must not match ordinary words ("Sam", "lag").
  const isAcronym = term => !/[a-z]/.test(term);

  // Lookups ignore case and collapse whitespace.
  const normalize = text => text.trim().toLowerCase().replace(/\s+/g, " ");

  // One regex for all terms, longest first, so "IAM role" wins over "IAM"
  // and "AWS Lambda function" over "AWS Lambda". Case-insensitive terms use
  // an inline (?i:) modifier (Chrome 125+).
  function buildRegex(entries) {
    if (!entries.size) return null;

    const alternatives = [...entries]
      .sort(([a], [b]) => b.length - a.length)
      .map(([term, sensitive]) =>
        sensitive ? termPattern(term) : `(?i:${termPattern(term)})`
      );

    return new RegExp(
      `(?<![A-Za-z0-9_\-])(?:${alternatives.join("|")})(?![A-Za-z0-9_])`,
      "g"
    );
  }

  // Rows from the bundled list. Groups match case-insensitively; caseSensitive
  // entries match only with the exact casing.
  function bundledRows() {
    const rows = [];
    for (const word of Object.values(bundled.groups || {}).flat()) rows.push({ word });
    for (const word of bundled.caseSensitive || []) rows.push({ word, exact: true });
    return rows;
  }

  // One row per word. Duplicates are merged: exact wins, and a meaning is kept
  // if any duplicate has one.
  function normalizeRows(rows) {
    const byWord = new Map();
    for (const row of rows) {
      const word = typeof row.word === "string" ? row.word.trim() : "";
      if (!word) continue;

      const previous = byWord.get(word);
      const meaning = typeof row.meaning === "string" ? row.meaning.trim() : "";
      byWord.set(word, {
        word,
        exact: Boolean(previous?.exact || row.exact === true),
        meaning: meaning || previous?.meaning || ""
      });
    }
    return [...byWord.values()];
  }

  let termRegex = null;
  let exactMeaning = new Map();
  let normalizedMeaning = new Map();
  let size = 0;

  /**
   * Rebuild the matcher from rows: [{ word, meaning?, exact? }].
   * Called with no argument, it uses the bundled list.
   */
  function configure(rows = bundledRows()) {
    const terms = normalizeRows(rows);
    const entries = new Map();
    exactMeaning = new Map();
    normalizedMeaning = new Map();

    for (const { word, exact, meaning } of terms) {
      entries.set(word, exact || isAcronym(word));
      if (meaning) {
        exactMeaning.set(word, meaning);
        normalizedMeaning.set(normalize(word), meaning);
      }
    }

    termRegex = buildRegex(entries);
    size = entries.size;
  }

  // "subnets" finds the meaning of "subnet" when the plural itself is not listed.
  function meaningFor(surface) {
    const exact = exactMeaning.get(surface.trim());
    if (exact) return exact;

    const key = normalize(surface);
    return normalizedMeaning.get(key) ?? normalizedMeaning.get(key.replace(/es$|s$/, ""));
  }

  configure();

  /**
   * Replace dictionary terms with [[n]] placeholders.
   * Returns { text, terms, meanings } where terms[n] is the original surface text
   * and meanings[n] is the Japanese meaning (undefined for terms kept in English).
   */
  function protect(source) {
    const terms = [];
    const meanings = [];
    if (!source || /\[\[\s*\d+\s*\]\]/.test(source)) {
      return { text: source || "", terms, meanings };
    }

    if (!termRegex) return { text: source, terms, meanings };

    const text = source.replace(termRegex, match => {
      terms.push(match);
      meanings.push(meaningFor(match));
      return `[[${terms.length - 1}]]`;
    });

    return { text, terms, meanings };
  }

  /**
   * Put the terms back: a term with a meaning becomes its meaning, a kept term
   * its English text. Returns null when any placeholder was lost, so the caller
   * can fall back to a plain translation.
   */
  function restore(translated, terms, meanings = []) {
    if (!terms.length) return translated;

    const seen = new Set();
    const restored = translated.replace(PLACEHOLDER, (match, n) => {
      const index = Number(n);
      if (index >= terms.length) return match;
      seen.add(index);
      return meanings[index] || terms[index];
    });

    return seen.size === terms.length ? restored : null;
  }

  root.__udemyQuizTranslatorDictionary = {
    protect,
    restore,
    configure,
    bundledRows,
    normalizeRows,
    get size() {
      return size;
    }
  };
})();
