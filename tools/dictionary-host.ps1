# Dictionary helper: a Chrome native messaging host for the dictionary editor.
#
# Chrome starts this script when the extension connects, and stops it (closes
# stdin) when the extension disconnects, is turned off, or Chrome exits.
# It needs only Windows PowerShell 5.1 and GitHub CLI (gh); no Node or git.
#
# Requests (JSON, one at a time):
#   ping    -> answers at once with $HostVersion (registered and up to date?)
#   update  -> replaces this file with the script the extension sends, then exits
#   status  -> whether gh is installed and logged in, the login, push permission
#   install -> installs GitHub CLI with winget
#   login   -> opens a PowerShell window that runs `gh auth login --web`
#   submit  -> owner: commits dictionary.json to the dictionary branch
#              others: forks, commits to a new branch, opens a pull request
#
# Registered by tools/register.ps1.

$ErrorActionPreference = "Stop"

# Raise this whenever the requests or their answers change. The editor reads it
# from the copy bundled in the extension and asks to update an older host.
$HostVersion = 2

$Repo ="songyu0608/udemy-japanese-translator"
$Branch = "dictionary"
$File = "dictionary.json"
$MaxWordLength = 200
$Utf8 = New-Object System.Text.UTF8Encoding $false

$stdin = [Console]::OpenStandardInput()
$stdout = [Console]::OpenStandardOutput()

# stdout carries the protocol, so diagnostics go to stderr only.
function Write-Log([string]$text) {
  [Console]::Error.WriteLine("[$(Get-Date -Format o)] $text")
}

# ---- Native messaging framing: 4-byte little-endian length + UTF-8 JSON ----

function Read-Exactly([int]$count) {
  $buffer = New-Object byte[] $count
  $offset = 0
  while ($offset -lt $count) {
    $read = $stdin.Read($buffer, $offset, $count - $offset)
    if ($read -le 0) { return $null }
    $offset += $read
  }
  return , $buffer
}

function Send-Message($object) {
  $bytes = $Utf8.GetBytes((ConvertTo-Json $object -Compress -Depth 6))
  $stdout.Write([BitConverter]::GetBytes([int]$bytes.Length), 0, 4)
  $stdout.Write($bytes, 0, $bytes.Length)
  $stdout.Flush()
}

class HelperError : System.Exception {
  HelperError([string]$message) : base($message) {}
}

# ---- GitHub CLI ----

# Installs change PATH in the registry; this process must see the new value.
function Update-PathFromRegistry {
  $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $user = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machine;$user"
}

function Find-Gh {
  Update-PathFromRegistry
  $command = Get-Command gh.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $default = Join-Path $env:ProgramFiles "GitHub CLI\gh.exe"
  if (Test-Path $default) { return $default }
  return $null
}

# Runs gh without a shell and returns exit code, stdout, and stderr.
function Invoke-Gh([string[]]$arguments) {
  $gh = Find-Gh
  if (-not $gh) { throw [HelperError]::new("GitHub CLI is not installed.") }

  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = $gh
  $info.Arguments = ($arguments | ForEach-Object { ConvertTo-Argument $_ }) -join " "
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $info.StandardOutputEncoding = $Utf8
  $info.StandardErrorEncoding = $Utf8

  $process = [System.Diagnostics.Process]::Start($info)
  $out = $process.StandardOutput.ReadToEndAsync()
  $err = $process.StandardError.ReadToEndAsync()
  $process.WaitForExit()
  return [pscustomobject]@{
    Code = $process.ExitCode
    Out = $out.Result.Trim()
    Err = $err.Result.Trim()
  }
}

# Quotes one argument for the Windows command line (CommandLineToArgvW rules).
function ConvertTo-Argument([string]$value) {
  if ($value -and $value -notmatch '[\s"]') { return $value }
  $escaped = $value -replace '(\\*)"', '$1$1\"'
  $escaped = $escaped -replace '(\\+)$', '$1$1'
  return '"' + $escaped + '"'
}

# Calls the GitHub API through gh. A request body is passed as a temporary JSON file.
function Invoke-GhApi([string]$path, [string]$method = "GET", $body = $null, [string]$jq = "") {
  $arguments = @("api", "-X", $method, $path)
  $temp = $null
  if ($null -ne $body) {
    $temp = [IO.Path]::GetTempFileName()
    [IO.File]::WriteAllText($temp, (ConvertTo-Json $body -Compress -Depth 6), $Utf8)
    $arguments += @("--input", $temp)
  }
  if ($jq) { $arguments += @("--jq", $jq) }
  try {
    $result = Invoke-Gh $arguments
  } finally {
    if ($temp) { Remove-Item $temp -Force -ErrorAction SilentlyContinue }
  }
  if ($result.Code -ne 0) {
    $detail = if ($result.Err) { $result.Err } else { $result.Out }
    throw [HelperError]::new("gh api $method $path failed: $detail")
  }
  return $result.Out
}

# ---- Requests ----

function Get-Status {
  if (-not (Find-Gh)) {
    return @{ ok = $true; gh = $false; ghAuth = $false }
  }
  $user = Invoke-Gh @("api", "user", "--jq", ".login")
  if ($user.Code -ne 0) {
    return @{ ok = $true; gh = $true; ghAuth = $false }
  }
  $push = Invoke-Gh @("api", "repos/$Repo", "--jq", ".permissions.push")
  return @{
    ok = $true
    gh = $true
    ghAuth = $true
    login = $user.Out
    canPush = ($push.Code -eq 0 -and $push.Out -eq "true")
  }
}

function Install-Gh {
  if (Find-Gh) { return @{ ok = $true; installed = $true } }

  $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
  if (-not $winget) {
    throw [HelperError]::new("winget is not available. Install App Installer from the Microsoft Store, then try again.")
  }

  Write-Log "installing GitHub CLI with winget"
  $process = Start-Process -FilePath $winget.Source -Wait -PassThru -WindowStyle Hidden -ArgumentList @(
    "install", "--id", "GitHub.cli", "-e", "--silent",
    "--accept-source-agreements", "--accept-package-agreements"
  )
  if (-not (Find-Gh)) {
    throw [HelperError]::new("GitHub CLI was not installed (winget exit code $($process.ExitCode)).")
  }
  return @{ ok = $true; installed = $true }
}

# The login runs in a visible window: gh shows a one-time code there. The
# extension opens github.com/login/device in a Chrome tab, so gh's own browser
# launch is turned off (GH_BROWSER) to avoid a second tab.
function Start-Login {
  $gh = Find-Gh
  if (-not $gh) { throw [HelperError]::new("GitHub CLI is not installed.") }

  $script = @"
`$host.UI.RawUI.WindowTitle = 'GitHub ログイン'
Write-Host 'GitHub ログイン' -ForegroundColor Cyan
Write-Host '1. 下に表示されるワンタイムコード (XXXX-XXXX) を確認してください。'
Write-Host '2. 質問が表示されたら Enter を押してください。'
Write-Host '3. 開いた Chrome タブ (github.com/login/device) にコードを入力して承認してください。'
Write-Host ''
`$env:GH_BROWSER = 'cmd /c rem'
& '$($gh -replace "'", "''")' auth login --web --hostname github.com --git-protocol https
if (`$LASTEXITCODE -eq 0) {
  Write-Host ''
  Write-Host 'ログインしました。この画面は閉じてかまいません。辞書エディターが続きを進めます。' -ForegroundColor Green
} else {
  Write-Host ''
  Write-Host 'ログインできませんでした。辞書エディターで「GitHub にログイン」ボタンをもう一度押してください。' -ForegroundColor Yellow
}
"@
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
  Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-NoExit", "-EncodedCommand", $encoded) | Out-Null
  Write-Log "opened the login window"
  return @{ ok = $true }
}

# Rejects anything that is not a valid version 2 dictionary file.
function Test-Content([string]$content) {
  try {
    $data = $content | ConvertFrom-Json
  } catch {
    throw [HelperError]::new("dictionary.json is not valid JSON.")
  }
  if ($data.version -ne 2 -or $null -eq $data.terms) {
    throw [HelperError]::new("dictionary.json must be version 2 with a terms array.")
  }
  foreach ($row in @($data.terms)) {
    $word = $row.word
    $ok = ($word -is [string]) -and $word.Trim().Length -gt 0 -and $word.Length -le $MaxWordLength
    if ($ok -and $null -ne $row.meaning) {
      $ok = ($row.meaning -is [string]) -and $row.meaning.Length -le $MaxWordLength
    }
    if ($ok -and $null -ne $row.exact) { $ok = $row.exact -is [bool] }
    if (-not $ok) { throw [HelperError]::new("Invalid row: $(ConvertTo-Json $row -Compress)") }
  }
  return @($data.terms).Count
}

# Git's blob id of the content, to skip a commit when nothing changed.
function Get-BlobSha([byte[]]$bytes) {
  $header = $Utf8.GetBytes("blob $($bytes.Length)`0")
  $sha1 = [Security.Cryptography.SHA1]::Create()
  $all = New-Object byte[] ($header.Length + $bytes.Length)
  [Array]::Copy($header, $all, $header.Length)
  [Array]::Copy($bytes, 0, $all, $header.Length, $bytes.Length)
  return (($sha1.ComputeHash($all) | ForEach-Object { $_.ToString("x2") }) -join "")
}

# Commits the file on a branch of a repository. Returns the commit id, or $null when unchanged.
function Write-DictionaryFile([string]$repository, [string]$branchName, [byte[]]$bytes, [string]$message) {
  $current = Invoke-GhApi "repos/$repository/contents/$($File)?ref=$branchName" -jq ".sha"
  if ($current -eq (Get-BlobSha $bytes)) { return $null }

  $body = @{
    message = $message
    content = [Convert]::ToBase64String($bytes)
    sha = $current
    branch = $branchName
  }
  return Invoke-GhApi "repos/$repository/contents/$File" "PUT" $body ".commit.sha"
}

function Submit-Dictionary($request) {
  $content = [string]$request.content
  $message = ([string]$request.message).Trim()
  if (-not $message) { throw [HelperError]::new("A commit message is required.") }
  if ($message.Length -gt 4000) { throw [HelperError]::new("The commit message is too long.") }
  $count = Test-Content $content
  $bytes = $Utf8.GetBytes($content)

  $status = Get-Status
  if (-not $status.ghAuth) { throw [HelperError]::new("GitHub CLI is not logged in.") }

  # Owner: commit straight to the dictionary branch.
  if ($status.canPush) {
    $commit = Write-DictionaryFile $Repo $Branch $bytes $message
    Write-Log "direct $(if ($commit) { 'changed' } else { 'no change' }) ($count terms)"
    if (-not $commit) { return @{ ok = $true; mode = "direct"; changed = $false } }
    return @{ ok = $true; mode = "direct"; changed = $true; commit = $commit.Substring(0, 7) }
  }

  # Everyone else: fork, commit to a new branch on the fork, open a pull request.
  $fork = Invoke-GhApi "repos/$Repo/forks" "POST" @{} ".full_name"
  for ($i = 0; $i -lt 30; $i++) {
    if ((Invoke-Gh @("api", "repos/$fork", "--jq", ".full_name")).Code -eq 0) { break }
    Start-Sleep -Seconds 1
  }

  $base = Invoke-GhApi "repos/$Repo/git/ref/heads/$Branch" -jq ".object.sha"
  $newBranch = "dictionary-update-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
  Invoke-GhApi "repos/$fork/git/refs" "POST" @{ ref = "refs/heads/$newBranch"; sha = $base } ".ref" | Out-Null

  $commit = Write-DictionaryFile $fork $newBranch $bytes $message
  if (-not $commit) {
    Invoke-Gh @("api", "-X", "DELETE", "repos/$fork/git/refs/heads/$newBranch") | Out-Null
    Write-Log "proposal no change ($count terms)"
    return @{ ok = $true; mode = "proposal"; changed = $false }
  }

  $owner = $fork.Split("/")[0]
  $url = Invoke-GhApi "repos/$Repo/pulls" "POST" @{
    title = $message.Split("`n")[0]
    head = "$($owner):$newBranch"
    base = $Branch
    body = "Submitted from the dictionary editor. Please review the changed terms."
  } ".html_url"
  Write-Log "proposal opened $url ($count terms)"
  return @{ ok = $true; mode = "proposal"; changed = $true; url = $url }
}

# Replaces this script with the copy bundled in the extension. The running
# process keeps the old code, so it exits after answering; the next request
# starts the new one.
function Update-Host($request) {
  $content = [string]$request.content
  if ($content -notmatch '(?m)^\$HostVersion = (\d+)') {
    throw [HelperError]::new("The update is not a dictionary host script.")
  }
  $version = [int]$Matches[1]
  $target = $PSCommandPath
  $temp = "$target.new"
  # Windows PowerShell 5.1 needs the BOM to read the Japanese text as UTF-8.
  [IO.File]::WriteAllText($temp, $content, (New-Object System.Text.UTF8Encoding $true))
  Move-Item -Path $temp -Destination $target -Force
  Write-Log "updated from version $HostVersion to $version"
  return @{ ok = $true; version = $version; restart = $true }
}

function Invoke-Request($request) {
  switch ([string]$request.type) {
    "ping" { return @{ ok = $true; version = $HostVersion } }
    "update" { return Update-Host $request }
    "status" { return Get-Status }
    "install" { return Install-Gh }
    "login" { return Start-Login }
    "submit" { return Submit-Dictionary $request }
    default { throw [HelperError]::new("Unknown request.") }
  }
}

# ---- Main loop: one request at a time until Chrome closes stdin ----

while ($true) {
  $header = Read-Exactly 4
  if ($null -eq $header) { break }
  $length = [BitConverter]::ToInt32($header, 0)
  $body = Read-Exactly $length
  if ($null -eq $body) { break }

  $id = $null
  try {
    $request = $Utf8.GetString($body) | ConvertFrom-Json
    $id = $request.id
    $answer = Invoke-Request $request
    $answer.id = $id
    Send-Message $answer
    if ($answer.restart) { break }
  } catch {
    $message = $_.Exception.Message
    Write-Log "error: $message"
    Send-Message @{ id = $id; ok = $false; error = $message }
  }
}
