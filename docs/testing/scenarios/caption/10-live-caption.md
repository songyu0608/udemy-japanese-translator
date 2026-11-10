# Live Caption Scenarios

## Live Caption Scenarios
- Design: [Live Caption Design](../../../design/caption/10-live-caption.md#caption-translation)

### Caption Translated After Start
- Input: Lecture "251. Final Exam Tips" with English CC; cue "You can make sure you have really understood everything and you had memorized it."
- Steps: Translation started → `drain()` → `setJapanese()`
- Result: Overlay shows a Japanese sentence (e.g. "すべてを本当に理解し、暗記したかどうかを確認できます。"); the English cue is hidden
- Test: Manual on Udemy (passed 2026-11-10 with the button click)

### Captions Start by Themselves
- Input: Lecture with English CC; the model is installed; captions were not turned off before
- Steps: Page load → `core.onReady()` → `start()`
- Result: Japanese captions appear without clicking the button; the button reads 日本語字幕 オフ ×
- Test: Manual (not yet run after the change)

### Turning Off Is Remembered
- Input: User clicks 日本語字幕 オフ ×, then opens another lecture
- Steps: `stop()` and `localStorage.udemyJapaneseCaptionOff = "1"` → next page: `core.onReady()` skips `start()`
- Result: English captions only, button reads 日本語字幕 開始; clicking it starts again and clears the flag
- Test: Manual (not yet run)

### Model Must Be Downloaded
- Input: New PC; `Translator.availability()` returns `downloadable`
- Steps: First click on the page → core creates the translator → `core.onReady()` → `start()`
- Result: Japanese captions start after the download; a click on the caption button instead shows the download percent on the button
- Test: Manual (not yet run)

### Dictionary Terms in Captions
- Input: Cue "Launch an EC2 instance in a private subnet"
- Steps: `core.translate()` → dictionary `protect()` / `restore()`
- Result: "private subnet" and "EC2 instance" stay in English, as in the quiz
- Test: Manual (not yet run)
