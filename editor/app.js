    "use strict";

    const REPO = "songyu0608/udemy-japanese-translator";
    const BRANCH = "dictionary";
    const RAW_URL = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/dictionary.json`;
    // Registering works only in the extension's side panel, where background.js
    // reaches the helper. Opened anywhere else, this page is read-only.
    const IS_EXTENSION = typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
    const LOGIN_URL = "https://github.com/login/device";
    const ROLE_KEY = "dictionaryHelperRole";
    const HOST_SCRIPT = "tools/dictionary-host.ps1";
    const TRUE_VALUES = new Set(["y", "yes", "true", "1", "o", "x", "v", "○", "✓"]);
    const LIST_LIMIT = 100;

    const $ = id => document.getElementById(id);
    const ui = {
      reload: $("reload"), helper: $("helper"), helperStop: $("helperStop"), cancel: $("cancel"),
      search: $("search"), count: $("count"), problems: $("problems"),
      body: $("body"), register: $("register"), changes: $("changes"), status: $("status"),
      grid: $("grid"), newWord: $("newWord"), newMeaning: $("newMeaning"),
      newExact: $("newExact"), addTerm: $("addTerm"),
      firstPage: $("firstPage"), prevPage: $("prevPage"), nextPage: $("nextPage"),
      lastPage: $("lastPage"), pageInfo: $("pageInfo"), pageSize: $("pageSize")
    };

    // rows: [{ id, word, meaning, exact }]. Edits change these objects directly.
    let rows = [];
    // snapshot: word → { meaning, exact } as loaded from the branch.
    let snapshot = new Map();
    // helper: { login, canPush } from the last status answer (kept for the button
    // label between visits), or null when unknown.
    let helper = readRole();
    let helperRunning = false;
    // The step of the register chain the button shows:
    // "" (idle), "busy", "register", "update", "install", "login", "waitLogin".
    let step = "";
    // Incremented to abandon a chain that is waiting (cancel, helper turned off).
    let chainId = 0;
    let nextId = 1;
    let query = "";
    let sort = { key: null, dir: 1 };
    // Pagination: `page` is 1-based; `pages` and `matched` are set by render().
    let page = 1;
    let pageSize = 100;
    let pages = 1;
    let matched = 0;

    function newRow(word = "", meaning = "", exact = false) {
      return { id: nextId++, word, meaning, exact };
    }

    function toRows(terms) {
      return terms.map(t => newRow(String(t.word || ""), t.meaning || "", t.exact === true));
    }

    function snapshotOf(list) {
      const map = new Map();
      for (const r of list) {
        const word = r.word.trim();
        if (word && !map.has(word)) map.set(word, { meaning: r.meaning.trim(), exact: r.exact });
      }
      return map;
    }

    function wordCounts() {
      const counts = new Map();
      for (const r of rows) {
        const word = r.word.trim();
        if (word) counts.set(word, (counts.get(word) || 0) + 1);
      }
      return counts;
    }

    function changes() {
      const seen = new Set();
      const added = [];
      const changed = [];
      for (const r of rows) {
        const word = r.word.trim();
        if (!word || seen.has(word)) continue;
        seen.add(word);
        if (!snapshot.has(word)) {
          added.push(word);
        } else {
          const old = snapshot.get(word);
          if (old.meaning !== r.meaning.trim() || old.exact !== r.exact) changed.push(word);
        }
      }
      const removed = [...snapshot.keys()].filter(word => !seen.has(word));
      return { added, changed, removed };
    }

    // Returns a message when the rows cannot be submitted yet.
    function problems() {
      const empty = rows.filter(r => !r.word.trim()).length;
      if (empty) return `単語が空の行が ${empty} 件あります。入力するか削除してください。`;

      const counts = wordCounts();
      const dups = [...counts].filter(([, n]) => n > 1).map(([word]) => word);
      if (dups.length) return `同じ単語が複数の行にあります: ${dups.slice(0, 5).join(", ")}`;
      return null;
    }

    function say(message, kind = "") {
      ui.status.textContent = message;
      ui.status.className = `status ${kind}`;
    }

    function sayWithLink(message, url, label = " 開く") {
      say(message, "ok");
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = label;
      ui.status.append(link);
    }

    function compareRows(a, b) {
      if (sort.key === "exact") {
        if (a.exact !== b.exact) return (a.exact ? 1 : -1) * sort.dir;
        return a.word.localeCompare(b.word, "en") * sort.dir;
      }
      const left = sort.key === "meaning" ? a.meaning : a.word;
      const right = sort.key === "meaning" ? b.meaning : b.word;
      return left.localeCompare(right, "en") * sort.dir;
    }

    function cellInput(r, col) {
      const input = document.createElement("input");
      input.type = "text";
      input.className = col;
      input.dataset.col = col;
      input.value = r[col];
      input.autocomplete = "off";
      input.spellcheck = false;
      input.addEventListener("input", () => {
        r[col] = input.value;
        updateFlags();
        updateSummary();
      });
      input.addEventListener("keydown", e => onKeydown(e, input));
      input.addEventListener("paste", e => onPaste(e, r));
      return input;
    }

    function rowElement(r, number, counts) {
      const tr = document.createElement("tr");
      tr.dataset.id = r.id;

      const num = document.createElement("td");
      num.className = "rownum";
      num.textContent = number;

      const word = document.createElement("td");
      word.append(cellInput(r, "word"));

      const meaning = document.createElement("td");
      meaning.append(cellInput(r, "meaning"));

      const exact = document.createElement("td");
      exact.className = "check";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = r.exact;
      box.setAttribute("aria-label", "大文字と小文字を区別");
      box.addEventListener("change", () => {
        r.exact = box.checked;
        updateSummary();
      });
      exact.append(box);

      const del = document.createElement("td");
      del.className = "del";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove";
      remove.textContent = "×";
      remove.setAttribute("aria-label", "行を削除");
      remove.addEventListener("click", () => {
        rows = rows.filter(x => x !== r);
        render();
      });
      del.append(remove);

      tr.append(num, word, meaning, exact, del);
      applyFlags(tr, r, counts);
      return tr;
    }

    function applyFlags(tr, r, counts) {
      const word = r.word.trim();
      tr.classList.toggle("invalid", !word);
      tr.classList.toggle("dup", Boolean(word) && counts.get(word) > 1);
    }

    // Updates row highlighting after an edit without rebuilding the table,
    // so the cell being typed in keeps its focus.
    function updateFlags() {
      const counts = wordCounts();
      const byId = new Map(rows.map(r => [String(r.id), r]));
      for (const tr of ui.body.children) {
        const r = byId.get(tr.dataset.id);
        if (r) applyFlags(tr, r, counts);
      }
    }

    function updateHeaders() {
      for (const th of document.querySelectorAll("th.sortable")) {
        const arrow = th.querySelector(".arrow");
        const active = sort.key === th.dataset.key;
        arrow.textContent = active ? (sort.dir === 1 ? "▲" : "▼") : "";
      }
    }

    function updatePager() {
      ui.pageInfo.textContent = `${page} / ${pages} ページ`;
      ui.firstPage.disabled = ui.prevPage.disabled = page <= 1;
      ui.nextPage.disabled = ui.lastPage.disabled = page >= pages;
    }

    // ---- Helper ------------------------------------------------------------
    // background.js holds the native messaging port, so the helper keeps
    // running after the panel closes, until ヘルパーを停止 or the extension stops.
    function askHelper(request, timeoutMs = 30000) {
      return chrome.runtime
        .sendMessage({ target: "helper", action: "request", request, timeoutMs })
        .then(answer => answer || { ok: false, error: "No answer from the extension." })
        .catch(error => ({ ok: false, error: String(error.message) }))
        .then(async answer => {
          await refreshRunning();
          return answer;
        });
    }

    async function refreshRunning() {
      try {
        const state = await chrome.runtime.sendMessage({ target: "helper", action: "state" });
        helperRunning = Boolean(state?.running);
      } catch (_) {
        helperRunning = false;
      }
      updateHelper();
    }

    function readRole() {
      try {
        const role = JSON.parse(localStorage.getItem(ROLE_KEY) || "null");
        return role && typeof role.login === "string" ? role : null;
      } catch (_) {
        return null;
      }
    }

    function saveRole(role) {
      try {
        localStorage.setItem(ROLE_KEY, JSON.stringify(role));
      } catch (_) {}
    }

    function updateHelper() {
      if (!IS_EXTENSION) {
        ui.helper.textContent = "読み取り専用: 登録と登録申請は Chrome 拡張機能のサイドパネルで行えます。";
        ui.helper.className = "helper off";
        ui.helperStop.hidden = true;
        return;
      }
      const who = helper
        ? ` · ${helper.login} · ${helper.canPush ? "オーナー: 直接登録" : "PR で提案"}`
        : "";
      ui.helper.textContent = helperRunning ? `ヘルパー実行中${who}` : `ヘルパー停止中${who}`;
      ui.helper.className = helperRunning ? "helper ok" : "helper";
      ui.helperStop.hidden = !helperRunning;
    }

    function setStep(next) {
      step = next;
      updateSummary();
    }

    function fail(message) {
      setStep("");
      say(`失敗: ${message}`, "error");
    }

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

    function openSetupTab() {
      chrome.tabs.create({ url: chrome.runtime.getURL("editor/setup.html") });
    }

    function applyStatus(status) {
      if (!status.ghAuth) return;
      helper = { login: status.login, canPush: Boolean(status.canPush) };
      saveRole(helper);
    }

    // One click runs the whole chain: registered → GitHub CLI installed →
    // logged in → submit. A finished step goes straight on to the next check.
    // The chain stops only where the user must approve (install, login); the
    // button then shows that step, and its click resumes the chain.
    async function startChain() {
      const id = ++chainId;
      setStep("busy");
      say("ヘルパーを確認しています...");

      const ping = await askHelper({ type: "ping" }, 20000);
      if (id !== chainId) return;
      if (!ping.ok) {
        if (ping.missing) return registerThenContinue(id, false);
        // A helper from before version checks does not know ping.
        if (isUnknownRequest(ping)) return registerThenContinue(id, true);
        return fail(ping.error);
      }
      if (!(await isCurrentHost(id, ping))) return;
      await continueFromStatus(id);
    }

    // Opens the registration tab and waits until a helper of the bundled
    // version answers, then continues the chain. `replace` is set when an old
    // helper is installed that cannot update itself; a running one keeps its
    // old code, so it is restarted before each check.
    async function registerThenContinue(id, replace) {
      openSetupTab();
      setStep("register");
      say(replace
        ? "インストール済みのヘルパーは自動更新できないバージョンです。開いたタブの案内に従ってもう一度登録してください。登録されると自動で続行します。"
        : "この PC では最初に一度だけ登録が必要です。開いたタブの案内に従ってください。登録されると自動で続行します。");

      const needed = (await bundledHost())?.version || 0;
      for (;;) {
        await sleep(2000);
        if (id !== chainId) return;
        if (replace) await stopHelper();
        const ping = await askHelper({ type: "ping" }, 20000);
        if (id !== chainId) return;
        if (ping.ok && (Number(ping.version) || 0) >= needed) break;
        if (!ping.ok && !ping.missing && !isUnknownRequest(ping)) return fail(ping.error);
      }
      setStep("busy");
      await continueFromStatus(id);
    }

    function isUnknownRequest(answer) {
      return !answer.ok && /Unknown request/i.test(answer.error || "");
    }

    async function stopHelper() {
      try {
        await chrome.runtime.sendMessage({ target: "helper", action: "stop" });
      } catch (_) {}
      await refreshRunning();
    }

    // The helper script bundled in this extension is the expected version and
    // the update source, so the installed helper always matches the extension.
    async function bundledHost() {
      try {
        const response = await fetch(chrome.runtime.getURL(HOST_SCRIPT), { cache: "no-store" });
        const content = await response.text();
        const version = Number(/^\$HostVersion = (\d+)/m.exec(content)?.[1]);
        return version ? { version, content } : null;
      } catch (_) {
        return null;
      }
    }

    // Stops the chain with ヘルパーを更新 when the installed helper is older.
    async function isCurrentHost(id, ping) {
      const bundled = await bundledHost();
      if (id !== chainId) return false;
      if (!bundled) {
        console.warn("[Dictionary Editor] The bundled helper script could not be read; skipping the version check.");
        return true;
      }
      const installed = Number(ping.version) || 0;
      if (installed >= bundled.version) return true;

      setStep("update");
      say(`ヘルパーが古いバージョンです（インストール済み v${installed}、最新 v${bundled.version}）。「ヘルパーを更新」を押してください。`);
      return false;
    }

    async function approveUpdate() {
      const id = chainId;
      setStep("busy");
      say("ヘルパーを更新しています...");
      const bundled = await bundledHost();
      if (id !== chainId) return;
      if (!bundled) {
        setStep("update");
        say("拡張機能に含まれるヘルパーファイルを読み込めませんでした。拡張機能を再読み込みしてください。", "error");
        return;
      }

      const result = await askHelper({ type: "update", content: bundled.content }, 30000);
      if (id !== chainId) return;
      // Helpers from before the update request can only be replaced by registering again.
      if (isUnknownRequest(result)) return registerThenContinue(id, true);
      if (!result.ok) {
        setStep("update");
        say(`更新できませんでした: ${result.error}`, "error");
        return;
      }

      // The old process exits after answering; disconnect so the next request
      // starts the updated helper instead of reaching the closing one.
      await stopHelper();
      const ping = await askHelper({ type: "ping" }, 20000);
      if (id !== chainId) return;
      if (!ping.ok || (Number(ping.version) || 0) < bundled.version) {
        setStep("update");
        say(`更新を確認できませんでした。もう一度押してください。(${ping.error || `v${ping.version}`})`, "error");
        return;
      }
      say(`ヘルパーを v${ping.version} に更新しました。`, "ok");
      await continueFromStatus(id);
    }

    async function continueFromStatus(id) {
      say("GitHub CLI の状態を確認しています...");
      const status = await askHelper({ type: "status" }, 60000);
      if (id !== chainId) return;
      if (!status.ok) return fail(status.error);
      applyStatus(status);

      if (!status.gh) {
        setStep("install");
        say("GitHub CLI がインストールされていません。「GitHub CLI をインストール」を押すと winget でインストールします。");
        return;
      }
      if (!status.ghAuth) {
        setStep("login");
        say("GitHub にログインしていません。「GitHub にログイン」を押してください。");
        return;
      }
      await submit(id);
    }

    async function approveInstall() {
      const id = chainId;
      setStep("busy");
      say("GitHub CLI をインストールしています... 1〜2 分かかります。Windows の確認画面が出たら許可してください。");
      const result = await askHelper({ type: "install" }, 10 * 60000);
      if (id !== chainId) return;
      if (!result.ok) {
        setStep("install");
        say(`インストールできませんでした: ${result.error}`, "error");
        return;
      }
      await continueFromStatus(id);
    }

    async function approveLogin() {
      const id = chainId;
      setStep("busy");
      const result = await askHelper({ type: "login" }, 30000);
      if (id !== chainId) return;
      if (!result.ok) {
        setStep("login");
        say(`ログイン画面を開けませんでした: ${result.error}`, "error");
        return;
      }
      chrome.tabs.create({ url: LOGIN_URL });
      setStep("waitLogin");
      say("PowerShell 画面のワンタイムコードを、開いた GitHub タブに入力して承認してください。ログインすると自動で続行します。");

      const deadline = Date.now() + 10 * 60000;
      while (Date.now() < deadline) {
        await sleep(3000);
        if (id !== chainId) return;
        const status = await askHelper({ type: "status" }, 60000);
        if (id !== chainId) return;
        if (status.ok && status.ghAuth) {
          applyStatus(status);
          setStep("busy");
          await submit(id);
          return;
        }
      }
      setStep("login");
      say("ログインを確認できませんでした。「GitHub にログイン」をもう一度押してください。", "error");
    }

    function onRegisterClick() {
      if (step === "update") return approveUpdate();
      if (step === "install") return approveInstall();
      if (step === "login") return approveLogin();
      if (step === "register") return openSetupTab();
      if (!step) return startChain();
    }

    function updateSummary() {
      const withMeaning = rows.filter(r => r.meaning.trim()).length;
      ui.count.textContent = `全 ${rows.length} 行 · 検索結果 ${matched} 行 · 意味あり ${withMeaning} 件`;

      const problem = problems();
      ui.problems.textContent = problem ? "⚠ 登録不可" : "";
      ui.problems.title = problem || "";

      const { added, changed, removed } = changes();
      const dirty = added.length + changed.length + removed.length > 0;
      ui.changes.textContent = dirty
        ? `追加 ${added.length} · 変更 ${changed.length} · 削除 ${removed.length}`
        : "変更なし";

      // Owners commit directly; everyone else opens a pull request. While the
      // chain waits for approval, the button shows that step instead.
      const labels = {
        busy: "処理中...",
        register: "登録案内をもう一度開く",
        update: "ヘルパーを更新",
        install: "GitHub CLI をインストール",
        login: "GitHub にログイン",
        waitLogin: "ログイン待ち..."
      };
      // Until the helper has reported the permission once, the label is 登録;
      // the helper decides between a commit and a request either way.
      ui.register.textContent = labels[step] || (helper && !helper.canPush ? "登録申請" : "登録");
      ui.register.disabled = !IS_EXTENSION ||
        step === "busy" || step === "waitLogin" ||
        (!step && (!dirty || Boolean(problem)));
      ui.cancel.hidden = !step || step === "busy";
    }

    function render() {
      const counts = wordCounts();
      const numbers = new Map(rows.map((r, i) => [r.id, i + 1]));

      let view = rows;
      const q = query.trim().toLowerCase();
      if (q) {
        view = view.filter(r =>
          r.word.toLowerCase().includes(q) || r.meaning.toLowerCase().includes(q)
        );
      }
      if (sort.key) view = [...view].sort(compareRows);

      matched = view.length;
      pages = Math.max(1, Math.ceil(matched / pageSize));
      page = Math.min(Math.max(1, page), pages);
      const start = (page - 1) * pageSize;

      const fragment = document.createDocumentFragment();
      for (const r of view.slice(start, start + pageSize)) {
        fragment.append(rowElement(r, numbers.get(r.id), counts));
      }
      ui.body.replaceChildren(fragment);
      updatePager();

      updateHeaders();
      updateSummary();
    }

    // Enter moves to the same column in the next row (spreadsheet behavior).
    function onKeydown(event, input) {
      if (event.key !== "Enter" || event.isComposing) return;
      event.preventDefault();
      const next = input.closest("tr").nextElementSibling;
      next?.querySelector(`input[data-col="${input.dataset.col}"]`)?.focus();
    }

    // Pasting several spreadsheet rows inserts them after the current row.
    function onPaste(event, r) {
      const text = event.clipboardData.getData("text/plain");
      if (!/[\t\n\r]/.test(text)) return;
      event.preventDefault();

      const parsed = text
        .split(/\r?\n/)
        .filter(line => line.trim())
        .map(line => {
          const [word = "", meaning = "", exact = ""] = line.split("\t");
          return newRow(word.trim(), meaning.trim(), TRUE_VALUES.has(exact.trim().toLowerCase()));
        });
      if (!parsed.length) return;

      const index = rows.indexOf(r);
      const emptyCurrent = !r.word.trim() && !r.meaning.trim() && !r.exact;
      rows.splice(emptyCurrent ? index : index + 1, emptyCurrent ? 1 : 0, ...parsed);
      query = "";
      ui.search.value = "";
      render();
      say(`${parsed.length} 行を貼り付けました。`);
    }

    // Adds a term from the top form. Only the word is required; the new row
    // goes to the top of the table so it is visible right away.
    function addTerm() {
      const word = ui.newWord.value.trim();
      const meaning = ui.newMeaning.value.trim();
      if (!word) {
        say("単語を入力してください。意味は空欄でもかまいません。", "error");
        ui.newWord.focus();
        return;
      }
      if (word.length > 200 || meaning.length > 200) {
        say("単語と意味はそれぞれ 200 文字以内にしてください。", "error");
        return;
      }
      if (rows.some(r => r.word.trim() === word)) {
        say(`すでにある単語です: ${word}`, "error");
        ui.newWord.select();
        return;
      }

      rows.unshift(newRow(word, meaning, ui.newExact.checked));
      page = 1;
      ui.newWord.value = "";
      ui.newMeaning.value = "";
      ui.newExact.checked = false;
      query = "";
      ui.search.value = "";
      sort = { key: null, dir: 1 };
      render();
      ui.grid.scrollTop = 0;
      say(`追加しました: ${word}`, "ok");
      ui.newWord.focus();
    }

    // The whole dictionary.json content for the current rows (version 2).
    function buildFile() {
      const terms = rows
        .map(r => {
          const term = { word: r.word.trim() };
          if (r.meaning.trim()) term.meaning = r.meaning.trim();
          if (r.exact) term.exact = true;
          return term;
        })
        .sort((a, b) => a.word.localeCompare(b.word, "en"));
      return JSON.stringify({ version: 2, terms }, null, 2) + "\n";
    }

    // Reads the current dictionary.json from the branch (public, no token needed).
    async function load() {
      say("読み込み中...");
      try {
        const response = await fetch(RAW_URL, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        if (data.version !== 2 || !Array.isArray(data.terms)) {
          throw new Error("dictionary.json がバージョン 2 形式ではありません。");
        }

        rows = toRows(data.terms);
        page = 1;
        snapshot = snapshotOf(rows);
        query = "";
        ui.search.value = "";
        say(`${rows.length} 行を読み込みました。`, "ok");
      } catch (error) {
        say(`読み込み失敗: ${error.message}`, "error");
      }
      render();
    }

    // Last step of the chain: sends the full file and the commit message to the
    // helper. The helper decides between a direct commit (owner) and a pull
    // request (everyone else). The rows are read now, so edits made while the
    // chain waited are included.
    async function submit(id) {
      const problem = problems();
      if (problem) {
        fail(problem);
        return;
      }

      const { added, changed, removed } = changes();
      const list = (verb, words) => words.slice(0, LIST_LIMIT).map(w => `- ${verb} "${w}"`)
        .concat(words.length > LIST_LIMIT ? [`- ${verb} ${words.length - LIST_LIMIT} more`] : []);
      const message = [
        "[chore] Update dictionary terms",
        "",
        ...list("Add", added),
        ...list("Change", changed),
        ...list("Remove", removed)
      ].join("\n");

      setStep("busy");
      say(helper?.canPush ? "登録中..." : "登録申請中...");
      try {
        const data = await askHelper({ type: "submit", message, content: buildFile() }, 180000);
        if (id !== chainId) return;
        if (!data.ok) throw new Error(data.error || "The helper failed.");

        if (data.mode === "direct") {
          snapshot = snapshotOf(rows);
          say(data.changed ? `登録完了（コミット ${data.commit}）。次に開く翻訳ページから反映されます。` : "変更はありません。", "ok");
        } else if (data.changed) {
          snapshot = snapshotOf(rows);
          sayWithLink("登録申請完了。オーナーが確認すると反映されます。", data.url, " 申請内容を見る");
        } else {
          say("変更はありません。", "ok");
        }
      } catch (error) {
        say(`失敗: ${error.message}`, "error");
      } finally {
        if (id === chainId) setStep("");
      }
    }

    ui.reload.addEventListener("click", () => {
      if (isDirty() && !confirm("保存していない変更は失われます。続行しますか？")) return;
      load();
    });
    ui.helperStop.addEventListener("click", async () => {
      chainId++;
      setStep("");
      await chrome.runtime.sendMessage({ target: "helper", action: "stop" });
      await refreshRunning();
      say("ヘルパーを停止しました。登録ボタンを押すと再び起動します。", "ok");
    });
    ui.cancel.addEventListener("click", () => {
      chainId++;
      setStep("");
      say("キャンセルしました。");
    });
    ui.search.addEventListener("input", () => {
      query = ui.search.value;
      page = 1;
      render();
    });
    ui.firstPage.addEventListener("click", () => { page = 1; render(); });
    ui.prevPage.addEventListener("click", () => { page -= 1; render(); });
    ui.nextPage.addEventListener("click", () => { page += 1; render(); });
    ui.lastPage.addEventListener("click", () => { page = pages; render(); });
    ui.pageSize.addEventListener("change", () => {
      pageSize = Number(ui.pageSize.value);
      page = 1;
      render();
    });
    ui.addTerm.addEventListener("click", addTerm);
    for (const input of [ui.newWord, ui.newMeaning]) {
      input.addEventListener("keydown", e => {
        if (e.key === "Enter" && !e.isComposing) {
          e.preventDefault();
          addTerm();
        }
      });
    }
    ui.register.addEventListener("click", onRegisterClick);
    for (const th of document.querySelectorAll("th.sortable")) {
      th.addEventListener("click", () => {
        const key = th.dataset.key;
        sort = sort.key === key ? { key, dir: -sort.dir } : { key, dir: 1 };
        page = 1;
        render();
      });
    }

    function isDirty() {
      const { added, changed, removed } = changes();
      return added.length + changed.length + removed.length > 0;
    }

    window.addEventListener("beforeunload", e => {
      if (isDirty()) e.preventDefault();
    });

    load();
    if (IS_EXTENSION) refreshRunning();
    else updateHelper();
