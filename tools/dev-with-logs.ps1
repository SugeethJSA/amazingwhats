<#
.SYNOPSIS
    Opens Windows Terminal with Wails dev mode on the left and the live log on the right.
#>
$repo = Split-Path -Parent $PSScriptRoot
$run = Join-Path $PSScriptRoot 'dev-run.ps1'
$tail = Join-Path $PSScriptRoot 'dev-tail.ps1'

$wt = Get-Command wt -ErrorAction SilentlyContinue
if (-not $wt) {
    Write-Host 'Windows Terminal (wt) not found. Open two PowerShell windows and run:' -ForegroundColor Yellow
    Write-Host "  & '$run'"
    Write-Host "  & '$tail'"
    exit 1
}

# Stable window title; left pane runs the app, right pane tails the log.
$left = "powershell -NoExit -ExecutionPolicy Bypass -File `"$run`""
$right = "powershell -NoExit -ExecutionPolicy Bypass -File `"$tail`""
& $wt.Source -w 0 --title "amazingwhats dev + logs" $left ';' split-pane -H $right
