# Dictionary Sync Scenarios

## Dictionary Sync Scenarios
- Design: [Dictionary Sync Design](../../../design/translation/30-dictionary-sync.md#load-and-register)

### Remote Terms Loaded
- Input: `dictionary.json` with `terms` = `[{ "word": "private subnet", "meaning": "プライベートサブネット" }]`
- Steps: Open a Udemy quiz with "a private subnet"
- Result: Console shows "Loaded 1 dictionary terms." and the translation contains `プライベートサブネット`
- Test: Manual on a Udemy quiz page (not automated)

### Download Fails
- Input: Network error, HTTP 404, or no response within 3 seconds
- Steps: `loadGlossary()` catches the error
- Result: Console warns "Using the bundled dictionary terms."; translation continues with the bundled list
- Test: Manual (block the URL in DevTools)

### Invalid File
- Input: `dictionary.json` with `version` other than 2, `terms` not an array, or a row without a string `word`
- Steps: `isValidTerms()` returns false
- Result: The file is rejected; the bundled list is used
- Test: Manual

## Register Chain Scenarios
- Design: [Register Chain](../../../design/translation/30-dictionary-sync.md#register-chain)

### Ready PC Submits in One Click
- Input: Helper registered, gh installed and logged in as the owner; one row added
- Steps: Click 登録 → `ping` → `status` (ghAuth, canPush) → `submit`
- Result: New commit `[chore] Update dictionary terms` on `dictionary`; the status line shows the short commit id
- Test: Manual (not yet run)

### Unchanged File
- Input: The rows equal the file on `dictionary`
- Steps: `submit` → blob id of the new content equals the file's sha
- Result: No commit; the status line says 変更はありません. For a proposal, the new branch on the fork is deleted
- Test: Manual (not yet run; it calls the real GitHub API)

### First Use Needs Registration
- Input: Host not registered (Chrome answers "Specified native messaging host not found.")
- Steps: Click 登録申請 → guide tab opens, button shows 登録案内をもう一度開く → user runs the command → `ping` answers
- Result: The chain goes on to the GitHub CLI check without another click; the guide tab shows 登録されました
- Test: Manual (not yet run)

### Outdated Helper Updates on a Click
- Input: Installed helper reports `version` 1; the extension bundles `$HostVersion = 2`
- Steps: Click 登録 → `ping` answers 1 → button ヘルパーを更新 → click → `update` with the bundled script → host writes it and exits → `ping` answers 2
- Result: The chain continues to the GitHub CLI check; the installed file keeps the UTF-8 BOM
- Test: Manual with a stdin frame script (host part passed 2026-11-10: v1 → v2, BOM kept, exit after answer). The editor button is not yet run in the extension

### Helper Too Old to Update Itself
- Input: Installed helper answers `Unknown request.` to `ping` (before versions) or to `update` (version-less ping)
- Steps: The chain opens the guide tab → user registers again → editor and tab stop the old process before each `ping` → a helper of the bundled version answers
- Result: The chain continues; the tab shows 登録されました only when the new version answers
- Test: Host part checked 2026-11-10 (the version-less copy answered `Unknown request.` to `update`). Not yet run in the extension

### Invalid Update Is Rejected
- Input: `update` with content that has no `$HostVersion = N` line
- Steps: `Update-Host` checks the content
- Result: Error "The update is not a dictionary host script."; the installed file is unchanged
- Test: Manual with a stdin frame script (passed 2026-11-10)

### GitHub CLI Missing
- Input: Registered; gh not installed
- Steps: Chain stops at GitHub CLI をインストール → click → `install` (winget) → `status`
- Result: Nothing is installed before the click; after the install the chain checks the login at once
- Test: Manual (not yet run)

### Not Logged In
- Input: gh installed, not logged in
- Steps: Chain stops at GitHub にログイン → click → PowerShell login window and a github.com/login/device tab → user approves → `status` polled every 3 seconds sees the login
- Result: The change is submitted without clicking 登録 / 登録申請 again. Without approval in 10 minutes, the button returns to GitHub にログイン
- Test: Manual (not yet run)

### Cancel or Turn Off While Waiting
- Input: The chain waits at registration, install, or login
- Steps: Click キャンセル or ヘルパーを停止 → `chainId` changes
- Result: The waiting loop ends; the button returns to 登録 / 登録申請. ヘルパーを停止 also stops the helper process
- Test: Manual (not yet run)

### Helper Outlives the Panel
- Input: The helper ran a request; the side panel is closed and opened again
- Steps: `background.js` still holds the port → `state` answers running
- Result: The status line shows ヘルパー実行中. Turning the extension off ends the helper process
- Test: Manual (not yet run)

### Host Answers Through Chrome's Launch Path
- Input: User folder `C:\Users\シンジョンス`; `register.ps1` run from the checkout
- Steps: The launcher `dictionary-helper-host.bat` is started with a native messaging `ping` / `status` frame on stdin
- Result: `status` answers `{ gh: true, ghAuth: true, login: "JaceDashS", canPush: true }`; the host exits when stdin closes
- Test: Manual with a stdin frame script (passed 2026-11-10)
