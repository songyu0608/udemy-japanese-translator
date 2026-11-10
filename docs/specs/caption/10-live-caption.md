# Live Caption

## Requirements
- On a Udemy lecture with English captions (CC), Japanese captions appear over the video in real time
- Japanese captions start by themselves once the translator is ready. A new PC that must download the model starts after the first click on the page
- The English caption is hidden only while its Japanese text is shown, so a caption is never blank while it is being translated
- The button on the video (日本語字幕 オフ × / 日本語字幕 開始) turns Japanese captions off and on. Turning them off is remembered on this browser until they are turned on again
- Developer terms from the dictionary apply to captions the same way as to the quiz
- In native video fullscreen the overlay cannot be shown, so the English captions stay
- Udemy's caption DOM is never changed; only a class on `<html>` hides it and a separate overlay shows the Japanese text

Example:
- Input: English caption "You can make sure you have really understood everything and you had memorized it."
- Result: Overlay shows a Japanese sentence (e.g. "すべてを本当に理解し、暗記したかどうかを確認できます。") and the English caption is hidden

- Design: [Live Caption Design](../../design/caption/10-live-caption.md#caption-translation)
