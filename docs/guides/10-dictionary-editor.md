# Dictionary Editor

Click the extension icon in the Chrome toolbar; the editor opens in the side panel. Registering and proposing work only there. Opened outside the extension, the editor is read-only.

Saving uses a small helper on your PC that borrows your GitHub CLI (`gh`) login, so no token is stored in the browser or on a server. You do not set it up in advance: the 登録 / 登録申請 button walks you through it the first time.

## First Submit on a New PC
One click on **登録申請** (or **登録**) runs every step in order. It stops only where your approval is needed, and the button shows that step:

1. **Register the helper (once per PC).** A guide tab opens. Press **コマンドをコピー**, open PowerShell (Windows key, type PowerShell, Enter), paste, and press Enter. When the window prints `Done.`, the tab and the editor continue by themselves. The command only saves the helper to `%USERPROFILE%\.udemy-ja-dictionary-helper` and adds one registry key for Chrome; it installs nothing and needs no admin rights.
2. **GitHub CLI をインストール** (only if gh is missing). Click it to install GitHub CLI with winget. Allow the Windows prompt if one appears.
3. **GitHub にログイン** (only if you are not logged in). Click it: a PowerShell window shows a one-time code, and a Chrome tab opens github.com/login/device. Press Enter in the window, enter the code in the tab, and approve.
4. The change is submitted right away; you do not click 登録 / 登録申請 again.

Example:
- Input: New PC with Chrome and the extension only; one term added
- Steps: 登録申請 → guide tab, paste the command → GitHub CLI をインストール → GitHub にログイン, approve in the tab
- Result: The status line links to the new pull request

Use **キャンセル** to stop a waiting step. The helper keeps running in the background after you close the panel; **ヘルパーを停止** stops it. It also stops when the extension is turned off or reloaded, or Chrome exits.

## Edit
Each row is one term:
- 単語: the English word (required)
- 意味: the Japanese meaning (optional). Leave it empty to keep the word in English
- 大文字小文字の区別: check it for words that are ordinary English in lowercase (for example "haiku")

To add one term, type it in the top form (単語 is required) and press 追加 or Enter. The new row appears at the top. In a cell, Enter moves to the same column in the next row.

To add many rows, copy them from a spreadsheet (単語 TAB 意味 TAB Y) and paste into a 単語 cell.

## Submit
The button shows one of two actions, depending on your GitHub permission:
- **登録** (repository owner): commits the table straight to the `dictionary` branch. The status line says **登録完了**.
- **登録申請** (anyone else): the helper forks the repository once, commits your change to a new branch on your fork, and opens a pull request to `dictionary`. The status line says **登録申請完了** and links to the pull request (申請内容を見る).

After the owner merges a change, it applies on the next Udemy quiz page load. The extension does not need a reload.

## Notes
- The helper runs `gh` only (and `winget` for the GitHub CLI install), and only for this repository.
- The register script can be read before you run it: `tools/register.ps1` in this repository.
- Changing the bundled fallback (`dictionary-terms.js`) requires reloading the extension at chrome://extensions.
