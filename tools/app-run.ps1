<#
.SYNOPSIS
    Runs the COMPILED amazingwhats.exe with its log redirected to a file.
    Used by app-with-logs.ps1; the log is followed live in the other pane.
#>
$ErrorActionPreference = 'Continue'

$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$exe = Join-Path $repo 'bin\amazingwhats.exe'
if (-not (Test-Path $exe)) {
    throw "Compiled app not found: $exe (run wails3 build PRODUCTION=true first)"
}

$log = Join-Path $env:TEMP 'amazingwhats-app.log'
Remove-Item -Path $log -Force -ErrorAction SilentlyContinue
$env:AMAZINGWHATS_LOG_FILE = $log

Write-Host "App: $exe" -ForegroundColor Cyan
Write-Host "Log: $log" -ForegroundColor Cyan
& $exe
