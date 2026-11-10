
/*
 * Japanese Translator for Udemy: quiz and exam translation.
 * Chrome 138+ / English -> Japanese, on-device Translator API.
 * The translator, the dictionary, and the cache live in translator.js.
 */
(() => {
  "use strict";

  const INSTANCE = "__udemyLocalQuizTranslatorJaV1";
  if (window[INSTANCE]) return;
  window[INSTANCE] = true;

  try {
    window.stopQuizTranslation?.();
  } catch (_) {}

  const LOG = "[Japanese Translator]";
  const core = window.__udemyJapaneseTranslator;
  const translateCached = core.translate;

  let seq = 0;
  let lastKey = "";
  let debounceTimer;
  let lastUrl = location.href;

  const INLINE_ATTRIBUTE = "data-udemy-quiz-inline";
  const INLINE_SELECTOR = `[${INLINE_ATTRIBUTE}]`;
  let inlineNodes = [];
  // Exam result translations shown in the side column (null when below).
  let examSide = null;
  let lastRendered = null;

  // Inline translations appear directly on the Udemy page.
  const inlineStyles = document.createElement("style");
  inlineStyles.id = "udemy-quiz-inline-translator-styles";
  inlineStyles.textContent = `
    .udemy-quiz-inline-translation {
      box-sizing: border-box !important;
      display: block !important;
      flex-basis: 100%;
      grid-column: 1 / -1;
      min-width: 0;
      margin: 8px 0 12px !important;
      padding: 8px 11px !important;
      border-left: 3px solid #5289e8 !important;
      border-radius: 4px;
      background: rgba(82, 137, 232, .09) !important;
      color: inherit !important;
      font: inherit !important;
      line-height: 1.6 !important;
      list-style: none !important;
      overflow-wrap: anywhere;
      white-space: normal;
    }

    .udemy-quiz-inline-translation .uqt-text,
    .udemy-quiz-inline-translation .uqt-explanation {
      display: block;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .udemy-quiz-inline-translation .uqt-explanation {
      margin-top: 7px;
      padding-top: 7px;
      border-top: 1px solid rgba(82, 137, 232, .25);
    }

    .uqt-side-layer {
      position: fixed;
      z-index: 1000;
      overflow: hidden;
      pointer-events: none;
    }

    .uqt-side-layer .udemy-quiz-inline-translation.uqt-side {
      position: absolute !important;
      margin: 0 !important;
      pointer-events: auto;
    }
  `;
  (document.head || document.documentElement).append(inlineStyles);

  function clearInlineTranslations() {
    for (const node of document.querySelectorAll(INLINE_SELECTOR)) {
      node.remove();
    }
    inlineNodes = [];
    sideLayout = null;
    examSide = null;
    restoreShift();
  }

  function makeInlineTranslation(text, kind, explanation = "", anchor = null) {
    // Keep <ul>/<ol> children valid when an option is an <li>.
    const tag = anchor?.tagName === "LI" &&
      /^(UL|OL)$/.test(anchor.parentElement?.tagName || "")
      ? "li"
      : "div";

    const box = document.createElement(tag);
    box.className = "udemy-quiz-inline-translation";
    box.setAttribute(INLINE_ATTRIBUTE, kind);

    const translated = document.createElement("span");
    translated.className = "uqt-text";
    translated.textContent = text;

    box.append(translated);

    if (explanation) {
      const detail = document.createElement("span");
      detail.className = "uqt-explanation";
      detail.textContent = `解説\n${explanation}`;
      box.append(detail);
    }

    return box;
  }

  /*
   * Side layout: when the quiz column has enough empty space to the right of
   * the answer cards, translations float there in a fixed layer and follow
   * their originals on scroll. Otherwise they are inserted below (fallback).
   * Udemy centers the quiz column; in side mode only its horizontal margins
   * are overridden so the original and the translation are centered as a pair.
   * Udemy elements are never moved; only our own nodes are added.
   */
  const SIDE_MIN_WIDTH = 240;
  const SIDE_MAX_WIDTH = 560;
  const SIDE_GAP = 16;
  const SIDE_STACK_GAP = 8;
  const SHIFT_MIN_MARGIN = 24;
  const CENTERED_MIN_GAP = 40;
  let sideLayout = null;
  let shift = null;
  let relayoutFrame = 0;
  let relayoutFull = false;

  // Overflowing or not, a scroll container is the quiz column's boundary.
  function isScrollable(element) {
    return /(auto|scroll|overlay)/.test(getComputedStyle(element).overflowY);
  }

  // The nearest scroll container bounds both the free space and the clip area,
  // so translations never cover a sidebar next to the quiz column.
  function scrollParentOf(element) {
    for (let el = element.parentElement; el && el !== document.body; el = el.parentElement) {
      if (isScrollable(el)) return el;
    }
    return null;
  }

  function visibleRect(scroller) {
    const view = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    if (!scroller) return view;

    const r = scroller.getBoundingClientRect();
    return {
      left: Math.max(view.left, r.left),
      top: Math.max(view.top, r.top),
      right: Math.min(view.right, r.right),
      bottom: Math.min(view.bottom, r.bottom)
    };
  }

  // Returns where the side column starts and how wide it can be, or null.
  // A box may be as wide as the original column, but at least SIDE_MAX_WIDTH.
  function sideColumn(cards, scroller) {
    const rects = cards.map(c => c.getBoundingClientRect());
    const cardsRight = Math.max(...rects.map(r => r.right));
    const cardsWidth = cardsRight - Math.min(...rects.map(r => r.left));
    const limit = visibleRect(scroller).right;
    const space = limit - cardsRight - SIDE_GAP * 2;

    if (space < SIDE_MIN_WIDTH) return null;
    return {
      left: cardsRight + SIDE_GAP,
      width: Math.min(space, Math.max(SIDE_MAX_WIDTH, cardsWidth))
    };
  }

  function horizontalGaps(el) {
    const parent = el.parentElement;
    const ps = getComputedStyle(parent);
    const p = parent.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const contentLeft = p.left + parseFloat(ps.paddingLeft) + parseFloat(ps.borderLeftWidth);
    const contentRight = p.right - parseFloat(ps.paddingRight) - parseFloat(ps.borderRightWidth);
    return { left: r.left - contentLeft, right: contentRight - r.right, contentLeft, width: r.width };
  }

  // A vertical scrollbar (about 10-17px) on the scroll container makes a centered
  // column look 10px off-center, so the tolerance allows one scrollbar width.
  const CENTERED_TOLERANCE = 16;

  // Innermost ancestor holding the whole quiz that is centered in its parent
  // (margin auto, flex, or grid centering all look the same geometrically).
  function centeredColumn(quiz, scroller) {
    const { cards, header } = quiz.nodes;
    for (let el = cards[0].parentElement; el && el.parentElement; el = el.parentElement) {
      if (el === scroller || el === document.body) break;
      if (header && !el.contains(header)) continue;
      if (!cards.every(card => el.contains(card))) continue;

      const gaps = horizontalGaps(el);
      if (gaps.left > CENTERED_MIN_GAP && Math.abs(gaps.left - gaps.right) <= CENTERED_TOLERANCE) {
        return { el, ...gaps };
      }
    }
    return null;
  }

  function applyShift(el, marginLeft) {
    shift = {
      el,
      applied: `${Math.round(marginLeft)}px`,
      previous: ["margin-left", "margin-right"].map(name => ({
        name,
        value: el.style.getPropertyValue(name),
        priority: el.style.getPropertyPriority(name)
      }))
    };
    el.style.setProperty("margin-left", shift.applied, "important");
    el.style.setProperty("margin-right", "auto", "important");
  }

  function restoreShift() {
    if (!shift) return;
    for (const { name, value, priority } of shift.previous) {
      if (value) shift.el.style.setProperty(name, value, priority);
      else shift.el.style.removeProperty(name);
    }
    shift = null;
  }

  // Left margin that centers original + translation as a pair, or null when the
  // column is already there. The margin can move the column left or right.
  function shiftTarget(column, scroller, cards = null) {
    const clip = visibleRect(scroller);

    // The pair is measured from the real originals (cards), which can be
    // narrower than the element that holds them.
    const rects = cards ? cards.map(card => card.getBoundingClientRect()) : null;
    const left = rects ? Math.min(...rects.map(r => r.left)) : column.contentLeft + column.left;
    const width = rects ? Math.max(...rects.map(r => r.right)) - left : column.width;
    const translationWidth = Math.max(SIDE_MAX_WIDTH, width);
    // The translation starts one SIDE_GAP after the originals (see sideColumn).
    const pair = width + SIDE_GAP + translationWidth;

    // Where the pair's left edge must be to center it in the visible area, and
    // where the originals are now. The margin moves by the difference.
    const desiredLeft = clip.left + (clip.right - clip.left - pair) / 2;
    const target = Math.max(SHIFT_MIN_MARGIN, column.left + (desiredLeft - left));
    return Math.abs(target - column.left) > 1 ? target : null;
  }

  // Move the centered column left so original + translation are centered together.
  function shiftForSide(quiz, scroller) {
    const column = centeredColumn(quiz, scroller);
    if (!column) return;

    const target = shiftTarget(column, scroller, quiz.nodes.cards);
    if (target !== null) applyShift(column.el, target);
  }

  // Keeps the pair centered while the free width changes (a sidebar opening,
  // Udemy finishing its own centering) by updating the column margin in place.
  // The shifted column is no longer centered, so its current margin is the base.
  // Returns false when Udemy re-rendered the column or dropped the override;
  // the layout must then be rebuilt.
  function syncShift(quiz, scroller) {
    if (!shift) {
      shiftForSide(quiz, scroller);
      return true;
    }
    if (!shift.el.isConnected ||
        shift.el.style.getPropertyValue("margin-left") !== shift.applied) {
      return false;
    }

    const column = { el: shift.el, ...horizontalGaps(shift.el) };
    const target = shiftTarget(column, scroller, quiz.nodes.cards);
    if (target !== null) {
      shift.applied = `${Math.round(target)}px`;
      shift.el.style.setProperty("margin-left", shift.applied, "important");
    }
    return true;
  }

  function showSideTranslations(quiz, questionJa, answersJa, scroller) {
    const cards = quiz.nodes.cards;
    const reference = getComputedStyle(cards[0]);

    const layer = document.createElement("div");
    layer.className = "uqt-side-layer";
    layer.setAttribute(INLINE_ATTRIBUTE, "layer");
    layer.style.color = reference.color;
    layer.style.fontFamily = reference.fontFamily;
    layer.style.fontSize = reference.fontSize;

    const items = [{
      anchor: quiz.nodes.header?.isConnected ? quiz.nodes.header : cards[0],
      box: makeInlineTranslation(questionJa, "question")
    }];

    cards.forEach((card, i) => {
      items.push({
        anchor: card,
        box: makeInlineTranslation(answersJa[i].ja, "answer", answersJa[i].explanationJa)
      });
    });

    for (const { box } of items) {
      box.classList.add("uqt-side");
      layer.append(box);
      inlineNodes.push(box);
    }

    // Side boxes can be taller than the quiz. The spacer extends the page
    // after the last answer so the scroll container can reach every box.
    const last = cards[cards.length - 1];
    const spacer = document.createElement(last.tagName === "LI" ? "li" : "div");
    spacer.setAttribute(INLINE_ATTRIBUTE, "spacer");
    spacer.style.cssText = "display:block;height:0;margin:0;padding:0;list-style:none;";
    last.after(spacer);

    document.body.append(layer);
    sideLayout = { quiz, layer, items, cards, scroller, spacer };
    positionSide();
  }

  function positionSide() {
    if (!sideLayout) return true;
    const { quiz, layer, items, cards, scroller, spacer } = sideLayout;

    if (!syncShift(quiz, scroller)) return false;

    // Not enough room even after the shift: switch to the below layout.
    const column = sideColumn(cards, scroller);
    if (!column) return false;

    const clip = visibleRect(scroller);
    Object.assign(layer.style, {
      left: `${clip.left}px`,
      top: `${clip.top}px`,
      width: `${Math.max(0, clip.right - clip.left)}px`,
      height: `${Math.max(0, clip.bottom - clip.top)}px`
    });

    // Align each box with its original; push down when the previous box is taller.
    let previousBottom = -Infinity;
    for (const { anchor, box } of items) {
      const top = Math.max(anchor.getBoundingClientRect().top, previousBottom + SIDE_STACK_GAP);
      box.style.left = `${column.left - clip.left}px`;
      box.style.top = `${top - clip.top}px`;
      box.style.width = `${column.width}px`;
      previousBottom = top + box.offsetHeight;
    }

    // Grow only by what the boxes overflow below the last answer.
    const overflow = previousBottom - cards[cards.length - 1].getBoundingClientRect().bottom;
    spacer.style.height = `${Math.max(0, Math.ceil(overflow) + SIDE_STACK_GAP)}px`;

    return true;
  }

  // Scroll, content, and width changes reposition the side layout in place.
  // A full relayout (the width settled in the below layout, or the side layout
  // no longer fits) rebuilds it from the cached translations.
  function relayout() {
    const full = relayoutFull;
    relayoutFrame = 0;
    relayoutFull = false;

    if (examSide) {
      if (!full && positionExamSide()) return;
      if (examLast) renderExam(examLast.exam, examLast.translated);
      return;
    }
    if (!lastRendered) {
      // Exam results in the below layout: the side layout may fit now.
      if (full && examLast && examNodes.some(node => node.isConnected)) {
        renderExam(examLast.exam, examLast.translated);
      }
      return;
    }

    const { quiz, questionJa, answersJa } = lastRendered;
    if (quiz.nodes.cards.some(card => !card.isConnected)) return;

    if (!full && positionSide()) return;
    showInlineTranslations(quiz, questionJa, answersJa);
  }

  function requestRelayout() {
    if (!relayoutFrame) relayoutFrame = requestAnimationFrame(relayout);
  }

  function requestFullRelayout() {
    relayoutFull = true;
    requestRelayout();
  }

  addEventListener("scroll", requestRelayout, { capture: true, passive: true });
  // Width changes reach the width observer below; a height-only resize just
  // repositions the side layer.
  addEventListener("resize", requestRelayout, { passive: true });

  /*
   * A sidebar opening or closing changes the free width without a window
   * resize. Which ancestor changes width differs between Udemy pages, so a
   * ResizeObserver watches every ancestor of the quiz. It reports every
   * animation frame, so the side layout follows the width
   * in place. The below layout flows with the page by itself; it is rebuilt
   * once after the width settles, in case the side layout now fits.
   * Only width changes count: our boxes change heights, not widths.
   */
  const WIDTH_SETTLE_MS = 150;
  const watchedWidths = new Map();
  let widthSettleTimer;

  const widthObserver = new ResizeObserver(entries => {
    let changed = false;
    for (const entry of entries) {
      const width = Math.round(entry.contentRect.width);
      const previous = watchedWidths.get(entry.target);
      watchedWidths.set(entry.target, width);
      if (previous !== undefined && previous !== width) changed = true;
    }
    if (!changed) return;

    if (sideLayout || examSide) {
      requestRelayout();
      return;
    }
    clearTimeout(widthSettleTimer);
    widthSettleTimer = setTimeout(requestFullRelayout, WIDTH_SETTLE_MS);
  });

  function watchWidths(anchor) {
    const targets = [];
    for (let el = anchor.parentElement; el && el !== document.documentElement; el = el.parentElement) {
      targets.push(el);
    }
    if (targets.length === watchedWidths.size &&
        targets.every(target => watchedWidths.has(target))) return;

    widthObserver.disconnect();
    watchedWidths.clear();
    for (const target of targets) widthObserver.observe(target);
  }

  function showInlineTranslations(quiz, questionJa, answersJa) {
    clearInlineTranslations();
    const cards = quiz.nodes.cards;
    if (!cards.length || cards.some(card => !card.isConnected)) return;

    const scroller = scrollParentOf(cards[0]);
    watchWidths(cards[0]);
    shiftForSide(quiz, scroller);
    if (sideColumn(cards, scroller)) {
      showSideTranslations(quiz, questionJa, answersJa, scroller);
      return;
    }
    restoreShift();

    // The translated question goes between the original question and first answer.
    const questionBox = makeInlineTranslation(
      questionJa, "question", "", cards[0]
    );
    cards[0].before(questionBox);
    inlineNodes.push(questionBox);

    // Each translated choice follows its original choice without changing the input.
    cards.forEach((card, i) => {
      const translated = answersJa[i];
      const answerBox = makeInlineTranslation(
        translated.ja,
        "answer",
        translated.explanationJa,
        card
      );
      card.after(answerBox);
      inlineNodes.push(answerBox);
    });
  }

  function inlineIsCurrent(quiz) {
    return !!lastRendered &&
      lastRendered.cards.length === quiz.nodes.cards.length &&
      lastRendered.cards.every((card, i) =>
        card === quiz.nodes.cards[i] && card.isConnected
      ) &&
      inlineNodes.length === quiz.nodes.cards.length + 1 &&
      inlineNodes.every(node => node.isConnected);
  }

  // Extract Udemy question and answer elements.
  const CONTROL =
    'input[type="radio"],input[type="checkbox"],' +
    '[role="radio"],[role="checkbox"]';

  function isAfter(a, b) {
    return !!(
      a.compareDocumentPosition(b) &
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  }

  function findText(pattern) {
    const walk = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT
    );

    let n;

    while ((n = walk.nextNode())) {
      if (n.parentElement?.closest(INLINE_SELECTOR)) continue;

      if (pattern.test((n.nodeValue || "").trim())) {
        return n;
      }
    }

    return null;
  }

  // innerText includes the visible injected translations. Temporarily hide
  // only our nodes while reading the original answer and feedback text.
  function originalInnerText(element) {
    const nodes = [...element.querySelectorAll(INLINE_SELECTOR)];
    if (!nodes.length) return element.innerText || "";

    const previous = nodes.map(node => ({
      node,
      value: node.style.getPropertyValue("display"),
      priority: node.style.getPropertyPriority("display")
    }));

    try {
      nodes.forEach(node => node.style.setProperty("display", "none", "important"));
      return element.innerText || "";
    } finally {
      for (const { node, value, priority } of previous) {
        if (value) node.style.setProperty("display", value, priority);
        else node.style.removeProperty("display");
      }
    }
  }

  function cardOf(control) {
    let cur = control;
    let best = control.parentElement;

    while (
      cur.parentElement &&
      cur.parentElement !== document.body
    ) {
      const p = cur.parentElement;

      if (p.querySelectorAll(CONTROL).length !== 1) {
        break;
      }

      const text = originalInnerText(p).trim();

      if (text.length >= 8 && text.length < 6000) {
        best = p;
      }

      cur = p;
    }

    return best;
  }

  let lastNoQuizReason = "";

  // Logs why a quiz was not detected, once per reason, so new page layouts can be debugged.
  function noQuiz(reason) {
    if (reason !== lastNoQuizReason) {
      lastNoQuizReason = reason;
      console.info(LOG, "Quiz not detected:", reason);
    }
    return null;
  }

  // Reads each answer's text, selection, and feedback from its card.
  function readAnswers(cards, controls) {
    return cards.map((card, i) => {
      const lines = originalInnerText(card)
        .split(/\n+/)
        .map(s => s.trim())
        .filter(Boolean);

      const raw = lines[0] || "";

      const source = raw.replace(
        /\s*(?:Correct|Try again|Incorrect)\s*$/i,
        ""
      ).trim();

      const feedback = lines.slice(1).filter(s =>
        !/^(Correct|Incorrect|Try again|Explain this further|Show explanation)$/i.test(s)
      );

      const isCorrect = lines.some(s =>
        /(?:^|\s)Correct\s*$/i.test(s)
      );

      const isWrong = lines.some(s =>
        /(?:^|\s)(?:Try again|Incorrect)\s*$/i.test(s)
      );

      const el = controls[i];

      return {
        source,
        selected: el.matches("input")
          ? el.checked
          : el.getAttribute("aria-checked") === "true",
        status: isCorrect
          ? "correct"
          : isWrong
            ? "wrong"
            : "",
        explanation: feedback.join("\n").trim()
      };
    });
  }

  // Exam-style pages have no "Question N:" heading. The answer form itself
  // (data-testid="mc-quiz-question") is the quiz; its text before the first
  // answer is the question.
  function extractFormQuiz() {
    const form = document.querySelector('[data-testid="mc-quiz-question"]');
    if (!form) return null;

    const controls = [...form.querySelectorAll(CONTROL)];
    const natives = controls.filter(n => n.matches("input"));
    const picked = natives.length >= 2
      ? natives
      : controls.filter(n => n.matches("[role]"));
    if (picked.length < 2 || picked.length > 12) return null;

    const cards = picked.map(cardOf);
    const answers = readAnswers(cards, picked);
    if (answers.some(a => !a.source)) return null;

    // The question text may sit in the form or in a container just above it.
    let question = "";
    let container = form;
    for (let depth = 0; depth < 4 && container && container !== document.body && !question; depth++) {
      const lines = originalInnerText(container)
        .split(/\n+/)
        .map(s => s.trim())
        .filter(Boolean);
      const first = lines.findIndex(line => line.startsWith(answers[0].source));
      if (first > 0 && first < 30) question = lines.slice(0, first).join(" ");
      container = container.parentElement;
    }
    if (!question) return noQuiz("question text not found near the answer form");

    return {
      number: "form",
      question,
      answers,
      nodes: { cards, header: form.firstElementChild || form }
    };
  }

  function extractQuiz() {
    const headerNode = findText(
      /^(?:Question|질문|質問)\s*(\d+)\s*[:：]/i
    );

    if (!headerNode) return extractFormQuiz();

    const number = headerNode.nodeValue.match(
      /(?:Question|질문|質問)\s*(\d+)\s*[:：]/i
    )?.[1];

    if (!number) return null;

    const footerNode = findText(
      new RegExp(
        `^(?:Question\\s*${number}\\s*of\\s*\\d+|\\d+\\s*의\\s*질문\\s*${number}|質問\\s*${number}\\s*[/／]\\s*\\d+|\\d+\\s*問中\\s*${number}\\s*問目?)$`,
        "i"
      )
    );

    // Practice tests have no "Question N of M" footer, so the course content
    // list below (its completion checkboxes) would count as answers. Keep
    // only the controls of the answer form when the heading belongs to it.
    const form = document.querySelector('[data-testid="mc-quiz-question"]');
    const scope = form && (form.contains(headerNode) || isAfter(headerNode, form))
      ? form
      : null;

    const candidates = [
      ...document.querySelectorAll(CONTROL)
    ].filter(n =>
      isAfter(headerNode, n) &&
      (!footerNode || isAfter(n, footerNode)) &&
      (!scope || scope.contains(n))
    );

    const natives = candidates.filter(n =>
      n.matches("input")
    );

    const controls = natives.length >= 2
      ? natives
      : candidates.filter(n => n.matches("[role]"));

    if (
      controls.length < 2 ||
      controls.length > 12
    ) {
      return noQuiz(`${controls.length} answer controls after the question heading`);
    }

    const cards = controls.map(cardOf);
    const answers = readAnswers(cards, controls);

    if (answers.some(a => !a.source)) {
      return noQuiz("an answer has no text");
    }

    let question = "";

    try {
      const range = document.createRange();

      range.setStartAfter(headerNode);
      range.setEndBefore(cards[0]);

      // Ignore previously injected translations in the question range.
      const fragment = range.cloneContents();
      fragment.querySelectorAll(INLINE_SELECTOR).forEach(node => node.remove());
      question = (fragment.textContent || "").trim();
    } catch (_) {}

    if (!question) {
      const all = document.body.innerText;

      const prefix = new RegExp(
        `(?:Question|질문|質問)\\s*${number}\\s*[:：]\\s*`,
        "i"
      );

      const start = prefix.exec(all);

      if (start) {
        const rest = all.slice(
          start.index + start[0].length
        );

        const boundary = rest.indexOf(
          answers[0].source
        );

        if (boundary > 0) {
          question = rest.slice(0, boundary).trim();
        }
      }
    }

    if (!question) return null;

    question = question.replace(
      /^\s*(?:Question|질문|質問)\s*\d+\s*[:：]/i,
      ""
    ).trim();

    return {
      number,
      question,
      answers,
      nodes: { cards, header: headerNode.parentElement }
    };
  }

  // Exam result page (after submitting a practice exam). The selectors were
  // checked on one CCAR-F practice exam result page. Other exam types are not
  // verified, so these are the only result selectors used.
  const EXAM_RESULT = '[class*="question-result--question-result"]';
  const EXAM_QUESTION_BODY = ".rt-scaffolding";
  const EXAM_ANSWER_PANE = '[class*="result-pane--answer-result-pane"]';
  const EXAM_ANSWER_BODY = '[class*="answer-result-pane--answer-body"]';
  const EXAM_FEEDBACK = '[class*="answer-result-pane--answer-feedback"]';
  const EXAM_EXPLANATION = '[class*="result-pane--question-related-fields"]';
  const EXAM_MAX_TEXT = 6000;

  // Each text block keeps the element it is translated after. The key lists
  // only the source texts, so re-rendering with the same text is skipped.
  function extractExamResult() {
    const containers = [...document.querySelectorAll(EXAM_RESULT)];
    if (!containers.length) return null;

    const blocks = [];
    const add = (anchor, kind, textEl = anchor) => {
      if (!anchor || !textEl) return;
      const source = (textEl.innerText || "").replace(/[ \t]+\n/g, "\n").trim();
      if (!source || source.length > EXAM_MAX_TEXT) return;
      blocks.push({ el: anchor, kind, source });
    };

    for (const container of containers) {
      add(container.querySelector(EXAM_QUESTION_BODY), "question");

      for (const pane of container.querySelectorAll(EXAM_ANSWER_PANE)) {
        add(pane, "answer", pane.querySelector(EXAM_ANSWER_BODY));
      }

      add(container.querySelector(EXAM_FEEDBACK), "feedback");
      add(container.querySelector(EXAM_EXPLANATION), "explanation");
    }

    if (!blocks.length) return null;

    return {
      key: JSON.stringify(blocks.map(b => b.source)),
      blocks
    };
  }

  let examRenderedKey = "";
  let examNodes = [];

  let examLast = null;

  // Side mode (when the result column leaves room on the right): each translation
  // floats in a fixed layer next to its original and follows scrolling, like the quiz.
  // Otherwise each translation is inserted right after its original.
  function renderExam(exam, translated) {
    clearInlineTranslations();
    examNodes = [];

    const els = exam.blocks.map(block => block.el);
    const scroller = scrollParentOf(els[0]);
    watchWidths(els[0]);
    // Same column shift as the quiz: the centered result column moves left to
    // make room, so each original and its translation sit side by side.
    const layout = { nodes: { cards: els, header: els[0] } };
    shiftForSide(layout, scroller);
    if (sideColumn(els, scroller)) {
      renderExamSide(exam, translated, scroller, layout);
      return;
    }
    restoreShift();

    exam.blocks.forEach((block, i) => {
      if (!block.el.isConnected) return;
      const box = makeInlineTranslation(translated[i], block.kind);
      block.el.after(box);
      examNodes.push(box);
    });
  }

  function renderExamSide(exam, translated, scroller, layout) {
    const els = exam.blocks.map(block => block.el);

    const layer = document.createElement("div");
    layer.className = "uqt-side-layer";
    layer.setAttribute(INLINE_ATTRIBUTE, "layer");
    const reference = getComputedStyle(els[0]);
    layer.style.color = reference.color;
    layer.style.fontFamily = reference.fontFamily;
    layer.style.fontSize = reference.fontSize;

    const items = exam.blocks.map((block, i) => {
      const box = makeInlineTranslation(translated[i], block.kind);
      box.classList.add("uqt-side");
      layer.append(box);
      examNodes.push(box);
      return { anchor: block.el, box };
    });

    // The spacer extends the page below the last block so every box is reachable.
    const spacer = document.createElement("div");
    spacer.setAttribute(INLINE_ATTRIBUTE, "spacer");
    spacer.style.cssText = "display:block;height:0;margin:0;padding:0;";
    els[els.length - 1].after(spacer);

    document.body.append(layer);
    examSide = { layer, items, els, scroller, spacer, layout };
    positionExamSide();
  }

  // Returns false when the side layout no longer fits, so the caller re-renders.
  function positionExamSide() {
    if (!examSide) return false;
    const { layer, items, els, scroller, spacer, layout } = examSide;
    if (els.some(el => !el.isConnected)) return false;

    // Same as the quiz: the shift follows the free width in place.
    if (!syncShift(layout, scroller)) return false;

    const column = sideColumn(els, scroller);
    if (!column) return false;

    const clip = visibleRect(scroller);
    Object.assign(layer.style, {
      left: `${clip.left}px`,
      top: `${clip.top}px`,
      width: `${Math.max(0, clip.right - clip.left)}px`,
      height: `${Math.max(0, clip.bottom - clip.top)}px`
    });

    // Align each box with its original; push down when the previous box is taller.
    let previousBottom = -Infinity;
    for (const { anchor, box } of items) {
      const top = Math.max(anchor.getBoundingClientRect().top, previousBottom + SIDE_STACK_GAP);
      box.style.left = `${column.left - clip.left}px`;
      box.style.top = `${top - clip.top}px`;
      box.style.width = `${column.width}px`;
      previousBottom = top + box.offsetHeight;
    }

    const overflow = previousBottom - els[els.length - 1].getBoundingClientRect().bottom;
    spacer.style.height = `${Math.max(0, Math.ceil(overflow) + SIDE_STACK_GAP)}px`;
    return true;
  }

  async function updateExam(exam) {
    if (
      exam.key === examRenderedKey &&
      examNodes.length &&
      examNodes.every(node => node.isConnected)
    ) {
      // The text is unchanged, but the layout may have moved (sidebar, resize).
      requestRelayout();
      return;
    }

    const mySeq = ++seq;
    examRenderedKey = "";
    clearInlineTranslations();

    const translated = [];
    for (const block of exam.blocks) {
      translated.push(await translateCached(block.source));
    }

    // Skip stale results when the page changed during translation.
    if (mySeq !== seq) return;

    examLast = { exam, translated };
    renderExam(exam, translated);
    examRenderedKey = exam.key;
  }

  async function update() {
    if (!core.isReady()) return;

    const quiz = extractQuiz();

    if (!quiz) {
      const exam = extractExamResult();
      if (exam) {
        lastKey = "";
        lastRendered = null;
        try {
          await updateExam(exam);
        } catch (error) {
          examRenderedKey = "";
          console.error(LOG, "Exam translation failed.", error);
        }
        return;
      }

      examRenderedKey = "";
      ++seq; // An in-flight translation must not render an obsolete question.
      lastKey = "";
      lastRendered = null;
      clearInlineTranslations();
      return;
    }

    // DOM references must not be serialized as part of the content key.
    const key = JSON.stringify({
      number: quiz.number,
      question: quiz.question,
      answers: quiz.answers
    });

    if (key === lastKey) {
      // Udemy can replace its answer elements with identical text.
      if (lastRendered?.key === key && !inlineIsCurrent(quiz)) {
        showInlineTranslations(
          quiz, lastRendered.questionJa, lastRendered.answersJa
        );
        lastRendered.cards = [...quiz.nodes.cards];
        lastRendered.quiz = quiz;
      } else {
        // Feedback or explanations can change the card heights.
        requestRelayout();
      }
      return;
    }

    lastKey = key;
    const mySeq = ++seq;
    lastRendered = null;
    clearInlineTranslations();

    try {
      const questionJa = await translateCached(quiz.question);
      const answersJa = [];

      for (const a of quiz.answers) {
        answersJa.push({
          ...a,
          ja: await translateCached(a.source),
          explanationJa: await translateCached(a.explanation)
        });
      }

      if (mySeq !== seq) return;

      showInlineTranslations(quiz, questionJa, answersJa);
      lastRendered = {
        key,
        quiz,
        questionJa,
        answersJa,
        cards: [...quiz.nodes.cards]
      };
    } catch (error) {
      if (mySeq !== seq) return;

      lastKey = "";
      lastRendered = null;
      clearInlineTranslations();
      console.error(LOG, "Translation failed.", error);
    }
  }

  function schedule(immediate = false) {
    clearTimeout(debounceTimer);

    debounceTimer = setTimeout(
      update,
      immediate ? 0 : 400
    );
  }

  // Automatically detect dynamic page changes, excluding our own inline DOM.
  function isOwnMutation(mutation) {
    const target = mutation.target;
    if (target.parentElement?.closest(INLINE_SELECTOR)) return true;
    if (target.nodeType === Node.ELEMENT_NODE &&
        target.closest(INLINE_SELECTOR)) return true;

    if (mutation.type === "childList") {
      const changed = [...mutation.addedNodes, ...mutation.removedNodes];
      return changed.length > 0 && changed.every(node =>
        node.nodeType === Node.ELEMENT_NODE && node.matches(INLINE_SELECTOR)
      );
    }
    return false;
  }

  const observer = new MutationObserver(mutations => {
    if (!core.isReady()) return;
    if (mutations.every(isOwnMutation)) return;
    schedule();
  });

  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [
      "class",
      "checked",
      "aria-checked"
    ]
  });

  const interval = setInterval(() => {
    if (lastUrl !== location.href) {
      lastUrl = location.href;

      if (core.isReady()) {
        schedule(true);
      }
    }
  }, 1200);

  // Describes the quiz layout so a wrong side placement can be diagnosed.
  function layoutInfo() {
    const quiz = lastRendered?.quiz || extractQuiz();
    if (!quiz) return "No quiz found.";

    const scroller = scrollParentOf(quiz.nodes.cards[0]);
    const name = el => el
      ? el.tagName.toLowerCase() +
        (el.id ? `#${el.id}` : "") +
        [...el.classList].slice(0, 2).map(c => `.${c}`).join("")
      : "window";

    const chain = [];
    for (let el = quiz.nodes.cards[0]; el && el !== document.body; el = el.parentElement) {
      const cs = getComputedStyle(el);
      const g = el.parentElement ? horizontalGaps(el) : {};
      chain.push({
        el: name(el),
        width: Math.round(el.getBoundingClientRect().width),
        gapLeft: Math.round(g.left),
        gapRight: Math.round(g.right),
        display: cs.display,
        justify: cs.justifyContent,
        margin: `${cs.marginLeft} ${cs.marginRight}`,
        overflowY: cs.overflowY
      });
    }

    return {
      mode: sideLayout ? "side" : inlineNodes.length ? "below" : "none",
      shifted: shift ? name(shift.el) : null,
      scroller: name(scroller),
      viewport: innerWidth,
      chain
    };
  }

  // The first translation runs as soon as the shared translator is ready.
  const stopWaitingForTranslator = core.onReady(() => {
    lastKey = "";
    schedule(true);
  });

  // Development helpers.
  window.udemyJapaneseQuiz = {
    start: () => core.start(),
    layoutInfo,
    refresh: () => {
      lastKey = "";
      schedule(true);
    },
    destroy: () => {
      observer.disconnect();
      widthObserver.disconnect();
      clearTimeout(widthSettleTimer);
      clearTimeout(debounceTimer);
      clearInterval(interval);
      cancelAnimationFrame(relayoutFrame);
      removeEventListener("scroll", requestRelayout, { capture: true });
      removeEventListener("resize", requestRelayout);

      ++seq;
      clearInlineTranslations();
      inlineStyles.remove();
      lastRendered = null;

      stopWaitingForTranslator();

      delete window[INSTANCE];
      delete window.udemyJapaneseQuiz;
    }
  };

})();
