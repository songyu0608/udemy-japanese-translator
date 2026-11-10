# Dictionary Sync

## Requirements
- Terms are read from the `dictionary` branch of this repository (`dictionary.json`, version 2) on each Udemy page load, so a change takes effect without reloading the extension
- The file is data only. It must be `{ "version": 2, "terms": [...] }`, with at most 10000 rows. Each row needs a word of at most 200 characters, may have a string meaning of at most 200 characters, and may have a boolean `exact` flag. Anything else is rejected
- If the download fails, times out (3 seconds), or the file is invalid, the terms bundled in `dictionary-terms.js` are used
- Registering happens only in the extension's side panel. The editor opened outside the extension is read-only. GitHub Pages is not used
- The editor sends the full file to a local helper that uses the GitHub CLI (`gh`) login already on the PC. No token is stored in the browser or on a server. The helper needs only Windows PowerShell and GitHub CLI
- One click on 登録 / 登録申請 runs the whole chain: helper registered → GitHub CLI installed → logged in → submit. A finished step goes straight on to the next check
- The chain stops only where the user must approve: installing GitHub CLI and logging in. The button then shows that step (GitHub CLI をインストール, GitHub にログイン) and nothing runs until it is clicked
- The first time on a PC, the helper must be registered with Chrome once, outside Chrome. The editor opens a guide tab with a one-line command; the chain continues by itself once the helper answers
- When the installed helper is older than the one bundled in the extension, the chain stops and the button shows ヘルパーを更新. Its click replaces the helper and the chain continues. A helper too old to update itself is replaced by registering again (the guide tab opens)
- The helper keeps running in the background after the panel closes. It stops with ヘルパーを停止, or when the extension is turned off or reloaded, or Chrome exits
- A user with push permission commits directly to the `dictionary` branch. The button reads 登録, and the status line says 登録完了 with the short commit id
- Anyone else: the helper forks the repository, commits to a new branch, and opens a pull request to the `dictionary` branch. GitHub notifies the owner, who reviews and merges it. The button reads 登録申請, and the status line says 登録申請完了 with a link to the pull request (申請内容を見る)

Example:
- Input: Editor types `private subnet` and `プライベートサブネット` in the top form, presses 追加, then 登録. A word alone (no meaning) is also accepted; a word already in the table is rejected
- Result: The new row is at the top of the table. After 登録, the branch commit `[chore] Update dictionary terms` contains it
- Result: The branch commit `[chore] Update dictionary terms` contains the new row. The next Udemy page load translates "private subnet" as プライベートサブネット

- Design: [Dictionary Sync Design](../../design/translation/30-dictionary-sync.md#load-and-register)
- Guide: [Dictionary Editor](../../guides/10-dictionary-editor.md)
