<#
.SYNOPSIS
    Runs amazingwhats in Wails v3 dev mode with all backend output teed to a log file.
    Open tools/dev-tail.ps1 in a second pane to follow it live.
#>
$ErrorActionPreference = 'Continue'

$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$env:Path = "$env:LOCALAPPDATA\Programs\Go\go\bin;$env:USERPROFILE\go\bin;C:\msys64\ucrt64\bin;$env:Path"
$env:CGO_ENABLED = '1'

$wails = Join-Path $env:USERPROFILE 'go\bin\wails3.exe'
if (-not (Test-Path $wails)) {
    $cmd = Get-Command wails3 -ErrorAction SilentlyContinue
    if (-not $cmd) { throw 'wails3.exe not found. Install with: go install github.com/wailsapp/wails/v3/cmd/wails3@v3.1.0' }
    $wails = $cmd.Source
}

$log = Join-Path $env:TEMP 'amazingwhats-dev.log'
"===== dev session $(Get-Date -Format o) =====" | Tee-Object -FilePath $log -Append
Write-Host "Log file: $log" -ForegroundColor Cyan
Write-Host 'Enable verbose protocol logs by setting "debug": true in:' -ForegroundColor Cyan
Write-Host "  $(Join-Path $env:APPDATA 'amazingwhats\settings.json')" -ForegroundColor Cyan

& $wails dev -config ./build/config.yml -port 9245 2>&1 | Tee-Object -FilePath $log -Append
