<#
.SYNOPSIS
    Opens Windows Terminal with the COMPILED amazingwhats.exe running on the
    left and its live log on the right. Set debug:true in
    %APPDATA%\amazingwhats\settings.json for verbose protocol logs.
#>
$repo = Split-Path -Parent $PSScriptRoot
$run = Join-Path $PSScriptRoot 'app-run.ps1'
$tail = Join-Path $PSScriptRoot 'dev-tail.ps1'
$log = Join-Path $env:TEMP 'amazingwhats-app.log'

$wt = Get-Command wt -ErrorAction SilentlyContinue
if (-not $wt) {
    Write-Host 'Windows Terminal (wt) not found. Open two PowerShell windows and run:' -ForegroundColor Yellow
    Write-Host "  & '$run'"
    Write-Host "  & '$tail' -LogPath '$log'"
    exit 1
}

$left = "powershell -NoExit -ExecutionPolicy Bypass -File `"$run`""
$right = "powershell -NoExit -ExecutionPolicy Bypass -File `"$tail`" -LogPath `"$log`""
& $wt.Source -w 0 --title "amazingwhats app + logs" $left ';' split-pane -H $right
