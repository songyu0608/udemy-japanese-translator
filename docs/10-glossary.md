# Glossary

## Quiz
- Definition: One Udemy practice test question with its answer choices, as found on the page
- Code: `extractQuiz()` returns `{ number, question, answers, nodes }`
- Avoid: "test", "exam" when referring to a single question

## Caption
- Definition: The English subtitle text Udemy shows over a lecture video, and the Japanese overlay that replaces it
- Code: `caption.js`, `CAPTION_SELECTOR` (`[data-purpose="captions-cue-text"]`)
- Avoid: "subtitle track" (the extension reads the visible cue, not the track)

## Card
- Definition: The Udemy DOM element that wraps one answer choice, including its radio/checkbox control and feedback text
- Code: `cardOf()`, `quiz.nodes.cards`
- Avoid: "option element"

## Translator
- Definition: The Chrome built-in on-device Translator API instance (English to Japanese)
- Code: `translator.js` → `start()`, `translate()`; `window.__udemyJapaneseTranslator`
- Note: One translator is shared by the quiz and the captions

## Dictionary
- Definition: The list of developer terms kept in English in translations
- Code: `dictionary-terms.js`, `dictionary.js` → `protect()`, `restore()`, `configure()`
- Avoid: "glossary" for this feature (the glossary is this document)

## Term
- Definition: One row of the dictionary: an English word, an optional Japanese meaning, and an optional case-sensitive flag
- Code: `configure()`, `normalizeRows()` in `dictionary.js`; `terms` in `dictionary.json`
- Avoid: "pair", "entry" (use "term")

## Meaning
- Definition: The Japanese text that replaces a term in the translation. A term without a meaning stays in English
- Code: `meaningFor()`, `restore()` in `dictionary.js`
- Avoid: "translation" for this text

## Dictionary Branch
- Definition: The `dictionary` branch of this repository, which holds `dictionary.json` with the terms
- Code: `GLOSSARY_URL` in `translator.js`, `RAW_URL` in `editor/app.js`
- Avoid: "sync branch"

## Editor
- Definition: The page that edits the terms as a table. In the extension's side panel it registers them to the dictionary branch; opened outside the extension it is read-only
- Code: `editor/index.html`, `editor/app.js`
- Avoid: "admin page"

## Helper
- Definition: The PowerShell program on the user's PC that Chrome starts for the editor. It installs GitHub CLI and opens the login window on request, and commits or opens pull requests with the user's gh login
- Code: `tools/dictionary-host.ps1`, native host name `com.udemy.ja_dictionary_helper`, `background.js`
- Avoid: "server", "agent"

## Register Chain
- Definition: The steps one click on 登録 / 登録申請 runs in order: helper registered, GitHub CLI installed, logged in, submit. It pauses only for the user's approval
- Code: `startChain()` in `editor/app.js`

## Placeholder
- Definition: A `[[n]]` token that replaces a dictionary term during translation
- Code: `PLACEHOLDER` in `dictionary.js`

## Side Layout
- Definition: Inline translations floating in the empty space to the right of the quiz
- Code: `showSideTranslations()`, `.uqt-side-layer`
- Avoid: "sidebar" (that is Udemy's curriculum panel)

## Column Shift
- Definition: Overriding the horizontal margins of Udemy's centered quiz column so the original and its side translation are centered together
- Code: `shiftForSide()`, `centeredColumn()`, `restoreShift()`

## Inline Translation
- Definition: Japanese text inserted into the Udemy page directly under the original question or answer
- Code: `showInlineTranslations()`, `data-udemy-quiz-inline`
- Avoid: "panel" (the panel UI was removed)
