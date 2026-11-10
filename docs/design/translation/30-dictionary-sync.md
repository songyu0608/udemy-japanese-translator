# Dictionary Sync Design

## Load and Register
- Input: `GLOSSARY_URL` (raw `dictionary.json` on the `dictionary` branch); editor rows and the GitHub contents API
- Output: `configure(rows)` on the dictionary matcher; a commit on the `dictionary` branch
- Code: `translator.js` → `loadGlossary()`, `isValidTerms()`; `dictionary.js` → `configure()`; `editor/app.js` → `load()`, `submit()`
- Spec: [Dictionary Sync](../../specs/translation/30-dictionary-sync.md#requirements)
- Architecture: [Overview](../../architecture/10-overview.md#dictionary-sync)

Steps:
1. `loadGlossary()` fetches the raw file with `cache: "no-store"` and a 3 second abort timeout
2. The response must be OK JSON with `version` 2 and a valid `terms` array (`isValidTerms()`)
3. `configure(terms)` replaces the bundled list entirely
4. On any failure the bundled list stays in use and a warning is logged
5. `autoStart()` runs after step 4, and every translation awaits the load, so the first quiz or caption translation uses the loaded terms

```mermaid
flowchart LR
    A[Page load] --> B[fetch dictionary.json]
    B --> C{OK and valid?}
    C -- Yes --> D[configure with remote terms]
    C -- No --> E[keep bundled terms]
    D --> F[autoStart]
    E --> F
```

Representative scenario:
- Input: Remote `terms` = `[{ "word": "private subnet", "meaning": "プライベートサブネット" }]`
- Steps: `loadGlossary()` → `isValidTerms()` true → `configure()` → `protect()` on "a private subnet"
- Result: Translation contains `プライベートサブネット`
- All scenarios: [Dictionary Sync Scenarios](../../testing/scenarios/translation/30-dictionary-sync.md#dictionary-sync-scenarios)

## Editor
- `editor/index.html` is a single static page, opened in the extension's side panel. It reads `dictionary.json` from the branch and shows the rows in a spreadsheet-style table: 単語, 意味, 大文字小文字の区別 (checkbox), with a row number column
- Each row is one term. Edits change the row in memory; the table is rebuilt only for add, delete, sort, and search, so the cell being typed in keeps its focus
- Enter moves to the same column in the next row. Pasting tab-separated text (word, meaning, Y) into a cell inserts one row per line after the current row
- Headers sort the table. The search box filters by word or meaning
- The table shows 50, 100 (default), or 200 rows per page. Searching, sorting, and adding a term return to page 1
- The layout uses only the width its content needs (`fit-content`)
- Duplicate or empty words are highlighted and block registration
- The commit message lists added, changed, and removed words. Rows are sorted by word, and empty meanings are omitted
- Outside the extension (for example opened as a file) the editor is read-only: the button stays disabled and the status line says registering is in the side panel

## Register Chain
- Input: The edited rows; a click on 登録 / 登録申請
- Output: A commit on `dictionary` (owner) or a pull request (others), shown in the status line
- Code: `editor/app.js` → `startChain()`, `continueFromStatus()`, `approveInstall()`, `approveLogin()`, `submit()`, `onRegisterClick()`; `background.js` → `connect()`, `ask()`, `stop()`
- Spec: [Dictionary Sync](../../specs/translation/30-dictionary-sync.md#requirements)
- Architecture: [Overview](../../architecture/10-overview.md#dictionary-sync)

```mermaid
flowchart TD
    S[Click 登録 / 登録申請] --> A{ping answers?}
    A -- host not found or too old --> R[Open setup tab, poll ping every 2s] --> B
    A -- yes --> V{version >= bundled?}
    V -- no --> U[Button: ヘルパーを更新] -->|click| U2[send bundled script, host replaces itself and restarts] --> B
    V -- yes --> B{status: gh installed?}
    B -- no --> I[Button: GitHub CLI をインストール] -->|click| I2[install via winget] --> B
    B -- yes --> C{logged in?}
    C -- no --> L[Button: GitHub にログイン] -->|click| L2[PowerShell login window + Chrome tab, poll status every 3s] --> P
    C -- yes --> P[submit]
```

- `step` holds what the button shows: `""` (登録 / 登録申請), `busy`, `register`, `update`, `install`, `login`, `waitLogin`. A click on `update`, `install`, or `login` resumes the chain; on `register` it reopens the guide tab
- Version check (`isCurrentHost()`): the expected version is read from the helper script bundled in the extension (`tools/dictionary-host.ps1`, line `$HostVersion = N`, fetched with `chrome.runtime.getURL`). A `ping` answer without a version counts as 0
- Update (`approveUpdate()`): sends the bundled script in an `update` request, disconnects, and pings again to confirm the new version before continuing
- Too old to update (`registerThenContinue(id, true)`): a helper that answers `Unknown request.` to `ping` or `update` predates these requests. The guide tab opens; the editor and the tab stop the running helper before each `ping`, because a running process keeps its old code, and wait until a helper of the bundled version answers
- `chainId` is incremented by キャンセル and ヘルパーを停止, so a waiting loop ends instead of continuing an abandoned chain
- The rows are read at submit time, so edits made while the chain waited are included
- The button reads 登録 until the helper has reported the push permission once; after that, 登録 (owner) or 登録申請 (others). The last known login and permission are kept in the page's `localStorage` only for this label. The helper decides between a commit and a pull request at submit time, so the label never changes what happens
- Scenario: First click on a new PC by a non-owner → button 登録 → chain → status says no push permission → 登録申請中... → 登録申請完了; the next visit shows 登録申請
- Scenario: Clean PC, helper registered, no GitHub CLI → click 登録申請 → button GitHub CLI をインストール → click → installed → button GitHub にログイン → click → login window and tab → approved → pull request opened without another click
- All scenarios: [Dictionary Sync Scenarios](../../testing/scenarios/translation/30-dictionary-sync.md#register-chain-scenarios)

## Helper
- Code: `tools/dictionary-host.ps1` (native messaging host), `tools/register.ps1` (one-time registration), `editor/setup.html` and `editor/setup.js` (guide tab), `background.js` (port)
- Transport: Chrome native messaging (`nativeMessaging` permission). `background.js` holds the port, so the helper outlives the side panel; an open native port also keeps the service worker alive. Chrome closes the port, and the helper exits, when the extension stops or Chrome exits
- Requests, one at a time: `ping` (registration check and `$HostVersion`, no GitHub call), `update` (writes the script the extension sends over its own file with a UTF-8 BOM, then exits after answering; a text without a `$HostVersion = N` line is rejected), `status` (`gh` found, `gh api user` login, push permission), `install` (`winget install GitHub.cli`), `login` (a PowerShell window running `gh auth login --web` with `GH_BROWSER` set to a no-op, because the editor opens github.com/login/device in a Chrome tab), `submit`
- `submit` checks the file (version 2, valid rows) and then uses only `gh api`:
  - Owner: reads the file's blob sha on `dictionary`, skips when the new content has the same git blob id, otherwise `PUT contents` with that sha
  - Others: `POST forks`, waits for the fork, creates `dictionary-update-<ms>` from the upstream `dictionary` head, commits the file there, and opens the pull request. An unchanged file deletes the new branch and reports no change
- Registration (`register.ps1`, ASCII only so it runs through `irm | iex`): saves the host and a launcher to `%USERPROFILE%\.udemy-ja-dictionary-helper` and writes the registry key `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.udemy.ja_dictionary_helper`. The launcher runs `powershell.exe -File "%~dp0dictionary-host.ps1"`, so a non-ASCII user folder name never goes into the ASCII batch file. It installs nothing
- `dictionary-host.ps1` is saved with a UTF-8 BOM. Windows PowerShell 5.1 reads a file without one in the system code page, which breaks its Japanese login messages
- `$HostVersion` must be raised whenever a request or an answer changes; otherwise registered PCs keep a helper that does not match the editor
- Scenario: Installed v1, extension bundles v2 → `ping` answers 1 → ヘルパーを更新 → `update` → the host writes v2 and exits → next `ping` answers 2 → the chain continues
- stdout carries the protocol, so the host writes diagnostics to stderr and discards every other output
- Scenario: User folder `C:\Users\シンジョンス` → `register.ps1` → the launcher holds only `%~dp0` → `ping` and `status` answer through Chrome's launch path

## Known Limits
- The owner path commits on top of the latest file. A change registered by someone else after the editor loaded is overwritten, because the editor does not send the sha it loaded
- Re-registering through `irm | iex` downloads the helper from `main`. Until `main` has the version the extension bundles, a too-old helper on another PC cannot be replaced that way
- The pull request path (fork, branch, pull request) has not been run end to end yet, because the owner's account cannot fork its own repository
- The Udemy page's Content Security Policy may block the cross-origin `fetch`. This is not yet verified on a Udemy page. If it is blocked, the bundled list is used and a warning is logged
- The remote file replaces the bundled list as a whole; the bundled list is used only when the remote file is unavailable
