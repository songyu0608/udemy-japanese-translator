// Clicking the toolbar icon opens the dictionary editor in the side panel.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

/*
 * Dictionary helper connection. The service worker holds the native messaging
 * port, so the helper keeps running in the background after the side panel
 * closes. It stops when the user turns it off, or when the extension is turned
 * off, reloaded, or Chrome exits (Chrome closes the port, the helper exits).
 * An open native port also keeps this service worker alive.
 *
 * Pages talk to it with chrome.runtime.sendMessage({ target: "helper", ... }):
 *   { action: "request", request, timeoutMs } -> the helper's answer
 *   { action: "stop" }                        -> disconnects the helper
 *   { action: "state" }                       -> { running }
 */
const NATIVE_HOST = "com.udemy.ja_dictionary_helper";

let port = null;
let nextId = 1;
const pending = new Map();

function finishAll(answer) {
  for (const { resolve, timer } of pending.values()) {
    clearTimeout(timer);
    resolve(answer);
  }
  pending.clear();
}

function connect() {
  if (port) return port;
  const current = chrome.runtime.connectNative(NATIVE_HOST);

  current.onMessage.addListener(message => {
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    entry.resolve(message);
  });

  current.onDisconnect.addListener(() => {
    const error = chrome.runtime.lastError?.message || "The helper stopped.";
    // "Specified native messaging host not found." means it was never registered.
    const missing = /not found/i.test(error);
    if (port === current) port = null;
    finishAll({ ok: false, error, missing });
  });

  port = current;
  return port;
}

function ask(request, timeoutMs = 30000) {
  return new Promise(resolve => {
    const id = nextId++;
    const timer = setTimeout(() => {
      if (pending.delete(id)) resolve({ ok: false, error: "The helper did not answer." });
    }, timeoutMs);
    pending.set(id, { resolve, timer });
    try {
      connect().postMessage({ ...request, id });
    } catch (error) {
      pending.delete(id);
      clearTimeout(timer);
      resolve({ ok: false, error: String(error.message) });
    }
  });
}

function stop() {
  if (!port) return;
  // Our own disconnect does not fire onDisconnect, so waiting requests end here.
  port.disconnect();
  port = null;
  finishAll({ ok: false, error: "The helper was turned off.", stopped: true });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== "helper") return false;

  if (message.action === "request") {
    ask(message.request, message.timeoutMs).then(sendResponse);
    return true;
  }
  if (message.action === "stop") {
    stop();
    sendResponse({ ok: true });
    return false;
  }
  if (message.action === "state") {
    sendResponse({ running: Boolean(port) });
    return false;
  }
  return false;
});
