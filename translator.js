/*
 * Japanese Translator for Udemy: shared translation core.
 * Used by the quiz (content.js) and the captions (caption.js).
 * - One on-device Chrome Translator (English -> Japanese) for the whole page
 * - Dictionary terms from the dictionary branch (bundled list as fallback)
 * - One translation cache
 */
(() => {
  "use strict";

  const KEY = "__udemyJapaneseTranslator";
  if (window[KEY]) return;

  const LOG = "[Japanese Translator]";
  const LANGS = { sourceLanguage: "en", targetLanguage: "ja" };
  const CACHE_LIMIT = 1000;

  let translator = null;
  let creating = null;
  const readyCallbacks = new Set();
  const progressCallbacks = new Set();
  const cache = new Map();
  const dictionary = window.__udemyQuizTranslatorDictionary;

  // ---- Dictionary terms ----------------------------------------------------

  // Terms are loaded from the dictionary branch on each page load, so a change
  // takes effect without reloading the extension. The bundled list in
  // dictionary-terms.js stays in use when the download fails.
  const GLOSSARY_URL =
    "https://raw.githubusercontent.com/songyu0608/udemy-japanese-translator/dictionary/dictionary.json";
  const GLOSSARY_TIMEOUT_MS = 3000;
  const GLOSSARY_LIMITS = { terms: 10000, length: 200 };

  // The file is data only: every row needs a short word, and may have a string
  // meaning and a boolean exact flag. Anything else is rejected.
  function isValidTerms(terms) {
    if (!Array.isArray(terms) || terms.length > GLOSSARY_LIMITS.terms) return false;

    return terms.every(
      row =>
        row &&
        typeof row === "object" &&
        typeof row.word === "string" &&
        row.word.trim().length > 0 &&
        row.word.length <= GLOSSARY_LIMITS.length &&
        (row.meaning == null ||
          (typeof row.meaning === "string" && row.meaning.length <= GLOSSARY_LIMITS.length)) &&
        (row.exact === undefined || typeof row.exact === "boolean")
    );
  }

  async function loadGlossary() {
    if (!dictionary) return;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GLOSSARY_TIMEOUT_MS);

    try {
      const response = await fetch(GLOSSARY_URL, {
        cache: "no-store",
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      if (data?.version !== 2 || !isValidTerms(data.terms)) {
        throw new Error("Invalid dictionary file.");
      }

      dictionary.configure(data.terms);
      console.info(LOG, `Loaded ${data.terms.length} dictionary terms.`);
    } catch (error) {
      console.warn(LOG, "Using the bundled dictionary terms.", error);
    } finally {
      clearTimeout(timer);
    }
  }

  // Every translation waits for this, so the first one already uses the terms.
  const glossaryReady = loadGlossary();

  // ---- Translator ----------------------------------------------------------

  // Creates the translator once. A model download needs a user gesture, so a
  // click handler (caption button, first page click) may call this directly.
  // onProgress receives 0-100 while the model downloads.
  async function start(onProgress) {
    if (translator) return translator;
    if (onProgress) progressCallbacks.add(onProgress);
    if (creating) return creating;

    if (typeof Translator === "undefined" || typeof Translator.create !== "function") {
      console.warn(LOG, "Translator API is unavailable. Chrome 138+ desktop is required.");
      return null;
    }

    creating = (async () => {
      try {
        translator = await Translator.create({
          ...LANGS,
          monitor(m) {
            m.addEventListener("downloadprogress", e => {
              const percent = Math.round(e.loaded * 100);
              console.info(LOG, `Model download ${percent}%`);
              for (const callback of progressCallbacks) callback(percent);
            });
          }
        });
        for (const callback of readyCallbacks) callback();
        return translator;
      } catch (error) {
        console.error(LOG, "Failed to start the translator.", error);
        return null;
      } finally {
        creating = null;
        progressCallbacks.clear();
      }
    })();
    return creating;
  }

  function startOnFirstGesture() {
    const begin = () => {
      document.removeEventListener("pointerdown", begin, true);
      document.removeEventListener("keydown", begin, true);
      void start();
    };
    document.addEventListener("pointerdown", begin, true);
    document.addEventListener("keydown", begin, true);
    console.info(LOG, "Waiting for a page click to download the translation model.");
  }

  async function autoStart() {
    if (typeof Translator === "undefined") {
      console.warn(LOG, "Translator API is unavailable. Chrome 138+ desktop is required.");
      return;
    }

    try {
      const availability = await Translator.availability(LANGS);

      if (availability === "available") {
        void start();
      } else if (availability === "downloadable" || availability === "downloading") {
        startOnFirstGesture();
      } else {
        console.warn(LOG, `English to Japanese translation is ${availability}.`);
      }
    } catch (error) {
      console.error(LOG, "Failed to check translator availability.", error);
    }
  }

  // ---- Translation -----------------------------------------------------------

  // Kept terms stay in English; pairs are replaced with their Japanese meaning.
  // If the translator drops a placeholder, fall back to a plain translation
  // instead of showing a broken sentence.
  async function translateWithDictionary(source) {
    await glossaryReady;
    if (!translator) throw new Error("The translator is not ready.");
    if (!dictionary) return translator.translate(source);

    const { text, terms, meanings } = dictionary.protect(source);
    if (!terms.length) return translator.translate(source);

    const restored = dictionary.restore(await translator.translate(text), terms, meanings);
    if (restored !== null) return restored;

    console.debug(LOG, "Dictionary placeholder lost; using plain translation.", source);
    return translator.translate(source);
  }

  // Same text, same promise: the quiz and the captions share the results.
  function translate(source) {
    if (!source) return Promise.resolve("");
    if (cache.has(source)) return cache.get(source);

    const promise = translateWithDictionary(source).catch(error => {
      cache.delete(source);
      throw error;
    });

    cache.set(source, promise);
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
    return promise;
  }

  window[KEY] = {
    isReady: () => Boolean(translator),
    start,
    // Calls back once the translator is ready (at once if it already is).
    // Returns a function that removes the callback.
    onReady(callback) {
      if (translator) {
        callback();
        return () => {};
      }
      readyCallbacks.add(callback);
      return () => readyCallbacks.delete(callback);
    },
    translate
  };

  void glossaryReady.then(autoStart);
})();
