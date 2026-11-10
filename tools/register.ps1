# One-time registration of the dictionary helper with Chrome (Windows).
#
# Chrome lets an extension start a program on this PC only when the program is
# registered as a native messaging host. This script only registers it:
# - saves tools/dictionary-host.ps1 and a small launcher to ~\.udemy-ja-dictionary-helper
# - writes the host manifest and one registry key under HKCU (no admin rights)
# It installs nothing. GitHub CLI is installed later from the editor, on approval.
#
# Run in PowerShell:
#   irm https://raw.githubusercontent.com/songyu0608/udemy-japanese-translator/main/tools/register.ps1 | iex
#
# Kept ASCII-only so it runs the same through `irm | iex` and from a file.

function Register-DictionaryHelper {
  $repo = "songyu0608/udemy-japanese-translator"
  $hostName = "com.udemy.ja_dictionary_helper"
  $extensionId = "gldnmpappkjeenipohflffeinmfgmfai"
  $helperDir = Join-Path $HOME ".udemy-ja-dictionary-helper"
  $hostFile = Join-Path $helperDir "dictionary-host.ps1"

  New-Item -ItemType Directory -Force -Path $helperDir | Out-Null

  # From a checkout, use the local copy; through `irm | iex`, download it.
  $local = if ($PSScriptRoot) { Join-Path $PSScriptRoot "dictionary-host.ps1" } else { $null }
  if ($local -and (Test-Path $local)) {
    Copy-Item -Path $local -Destination $hostFile -Force
  } else {
    $url = "https://raw.githubusercontent.com/$repo/main/tools/dictionary-host.ps1"
    Invoke-WebRequest -Uri $url -OutFile $hostFile -UseBasicParsing
  }

  # Chrome runs the launcher; it finds the host next to itself (%~dp0), so a
  # non-ASCII user folder name never goes into the ASCII batch file.
  $launcher = Join-Path $helperDir "dictionary-helper-host.bat"
  $launcherText = "@echo off`r`npowershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"%~dp0dictionary-host.ps1`"`r`n"
  [IO.File]::WriteAllText($launcher, $launcherText, [Text.Encoding]::ASCII)

  $manifest = [ordered]@{
    name = $hostName
    description = "Udemy quiz translator dictionary helper"
    path = $launcher
    type = "stdio"
    allowed_origins = @("chrome-extension://$extensionId/")
  }
  $manifestFile = Join-Path $helperDir "$hostName.json"
  [IO.File]::WriteAllText($manifestFile, ($manifest | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))

  $key = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName"
  New-Item -Path $key -Force -Value $manifestFile | Out-Null

  # The earlier Node helper is no longer used.
  Remove-Item -Path (Join-Path $helperDir "dictionary-helper.js") -Force -ErrorAction SilentlyContinue

  Write-Host ""
  Write-Host "Done. The dictionary editor in Chrome continues by itself." -ForegroundColor Green
  Write-Host "You can close this window."
}

Register-DictionaryHelper
