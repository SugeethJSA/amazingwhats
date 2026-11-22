<#
.SYNOPSIS
    Canonical mother-only verifier for the amazingwhats @swarm.
    Runs Go build/vet/test and frontend test/build serially, with full logs.

.EXAMPLE
    powershell -File tools/verify_central.ps1 -LogName gate_demo
    powershell -File tools/verify_central.ps1 -LogName gate_clean -Clean
    powershell -File tools/verify_central.ps1 -LogName gate_w3 -Clean -Wails3

.NOTES
    Hard-won rules (do not simplify away):
    - Never set $ErrorActionPreference = "Stop": native stderr becomes a terminating
      NativeCommandError in Windows PowerShell 5.1 and aborts before logs/exit are written.
    - Build args are an explicit [string[]]; a single-element array is otherwise splatted
      character-by-character.
    - Workers never run this script. Only the mother does, one build at a time.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$LogName,
    [switch]$Clean,
    [switch]$Wails3,
    [switch]$NoFrontend,
    [string]$RepoRoot = ''
)

$ErrorActionPreference = 'Continue'
if ($LogName -match '[\\/]|\.\.') {
    Write-Error 'LogName must not contain path separators or ..'
    exit 2
}
if (-not $RepoRoot) {
    $scriptDir = $PSScriptRoot
    if (-not $scriptDir) { $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
    if (-not $scriptDir) { $scriptDir = (Get-Location).Path }
    $RepoRoot = (Resolve-Path (Join-Path $scriptDir '..')).Path
}
$log = Join-Path $env:USERPROFILE ($LogName + '.log')
$exitFile = Join-Path $env:USERPROFILE ($LogName + '.exit')
[System.IO.File]::WriteAllText($log, '')

function Write-Log {
    param([string]$Message)
    $line = '[' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '] ' + $Message
    [System.IO.File]::AppendAllText($log, $line + [Environment]::NewLine)
    Write-Output $line
}

$goBin = Join-Path $env:LOCALAPPDATA 'Programs\Go\go\bin'
$cliBin = Join-Path $env:USERPROFILE 'go\bin'
$env:Path = "$goBin;$cliBin;C:\msys64\ucrt64\bin;" + $env:Path
$env:CGO_ENABLED = '1'

$failures = [System.Collections.Generic.List[string]]::new()
$results = [System.Collections.Generic.List[string]]::new()

function Invoke-Step {
    param([string]$Name, [string]$Exe, [string[]]$Arguments, [switch]$Optional)
    Write-Log ("=== STEP: " + $Name + " ===")
    Write-Log ("CMD: " + $Exe + " " + ($Arguments -join ' '))
    & $Exe @Arguments 2>&1 | ForEach-Object {
        $text = [string]$_
        [System.IO.File]::AppendAllText($log, $text + [Environment]::NewLine)
        Write-Output $text
    }
    $code = $LASTEXITCODE
    $state = if ($code -eq 0) { 'OK' } else { 'FAIL' }
    $script:results.Add(($Name + ' => ' + $state + ' (exit ' + $code + ')')) | Out-Null
    if ($code -ne 0 -and -not $Optional) {
        $script:failures.Add(($Name + ' exit ' + $code)) | Out-Null
    }
    Write-Log ("=== END: " + $Name + " [" + $state + "] ===")
    return $code
}

Push-Location $RepoRoot
try {
    Write-Log ("Repo: " + $RepoRoot)
    Write-Log ("Log:  " + $log)
    Write-Log ("Clean=" + [bool]$Clean + " Wails3=" + [bool]$Wails3 + " Frontend=" + (-not $NoFrontend))
    Write-Log ("PATH=" + $env:Path)
    Write-Log ("CGO_ENABLED=" + $env:CGO_ENABLED)

    $null = Invoke-Step -Name 'go-version' -Exe 'go' -Arguments @('version')
    $null = Invoke-Step -Name 'go-build' -Exe 'go' -Arguments @('build', './...')

    $testArgs = [string[]]@('test', './...', '-p', '1')
    if ($Clean) { $testArgs = [string[]]@('test', './...', '-p', '1', '-count=1') }
    $null = Invoke-Step -Name 'go-test' -Exe 'go' -Arguments $testArgs

    $null = Invoke-Step -Name 'go-vet' -Exe 'go' -Arguments @('vet', './...')

    if ($Wails3) {
        $wails = Join-Path $cliBin 'wails3.exe'
        $null = Invoke-Step -Name 'wails3-bindings' -Exe $wails -Arguments @('generate', 'bindings', '-ts')
        $null = Invoke-Step -Name 'wails3-doctor' -Exe $wails -Arguments @('doctor') -Optional
    }

    if (-not $NoFrontend -and (Test-Path (Join-Path $RepoRoot 'frontend\package.json'))) {
        Push-Location (Join-Path $RepoRoot 'frontend')
        try {
            if (-not (Test-Path 'node_modules')) {
                $null = Invoke-Step -Name 'frontend-install' -Exe 'npm' -Arguments @('ci')
            }
            $null = Invoke-Step -Name 'frontend-test' -Exe 'npm' -Arguments @('test')
            $null = Invoke-Step -Name 'frontend-build' -Exe 'npm' -Arguments @('run', 'build')
        } finally { Pop-Location }
    } elseif (-not $NoFrontend) {
        Write-Log 'FAIL: frontend/package.json missing while frontend steps were requested'
        $failures.Add('frontend-package-json-missing') | Out-Null
    }
} finally { Pop-Location }

Write-Log '=== SUMMARY ==='
foreach ($r in $results) { Write-Log $r }
if ($failures.Count -eq 0) {
    Write-Log 'VERDICT: GREEN'
    [System.IO.File]::WriteAllText($exitFile, '0')
} else {
    Write-Log ('VERDICT: RED -> ' + ($failures -join ', '))
    [System.IO.File]::WriteAllText($exitFile, '1')
}
Write-Log ("Exit file: " + $exitFile)
Write-Output ('FINAL=' + $(if ($failures.Count -eq 0) { 'GREEN' } else { 'RED' }))
if ($failures.Count -eq 0) { exit 0 } else { exit 1 }
