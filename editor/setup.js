"use strict";

// One-time registration guide, opened in a tab by the dictionary editor.
// It shows the register command and waits until the helper answers.
const SCRIPT_URL =
  "https://raw.githubusercontent.com/songyu0608/udemy-japanese-translator/main/tools/register.ps1";
const COMMAND = `irm ${SCRIPT_URL} | iex`;
const POLL_MS = 2000;

const state = document.getElementById("state");
document.getElementById("command").textContent = COMMAND;
document.getElementById("source").href = SCRIPT_URL;

document.getElementById("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(COMMAND);
    state.textContent = "コマンドをコピーしました。PowerShell に貼り付けて Enter を押してください。登録を待っています...";
    state.className = "state";
  } catch (_) {
    state.textContent = "コピーできませんでした。上のコマンドを選択して手動でコピーしてください。";
    state.className = "state error";
  }
});

// The helper bundled in the extension sets the version a registration must reach.
async function neededVersion() {
  try {
    const response = await fetch(chrome.runtime.getURL("tools/dictionary-host.ps1"), { cache: "no-store" });
    return Number(/^\$HostVersion = (\d+)/m.exec(await response.text())?.[1]) || 0;
  } catch (_) {
    return 0;
  }
}

// An old helper that is already running keeps its old code, so it is stopped
// before each check; the next ping starts the helper that is now registered.
async function registered(needed) {
  try {
    await chrome.runtime.sendMessage({ target: "helper", action: "stop" });
    const answer = await chrome.runtime.sendMessage({
      target: "helper",
      action: "request",
      request: { type: "ping" },
      timeoutMs: 20000
    });
    return Boolean(answer?.ok) && (Number(answer.version) || 0) >= needed;
  } catch (_) {
    return false;
  }
}

async function waitForRegistration() {
  const needed = await neededVersion();
  while (!(await registered(needed))) {
    await new Promise(resolve => setTimeout(resolve, POLL_MS));
  }
  state.textContent = "登録されました。このタブを閉じて辞書エディターに戻ってください。エディターが次の手順に進みます。";
  state.className = "state ok";
}

waitForRegistration();
