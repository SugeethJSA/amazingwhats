<#
.SYNOPSIS
    Follows the dev log produced by tools/dev-run.ps1.
#>
param(
    [string]$LogPath = (Join-Path $env:TEMP 'amazingwhats-dev.log')
)
if (-not (Test-Path $LogPath)) {
    New-Item -ItemType File -Path $LogPath -Force | Out-Null
}
Write-Host "Following $LogPath (Ctrl+C to stop)" -ForegroundColor Cyan
Get-Content -Path $LogPath -Wait -Tail 80
