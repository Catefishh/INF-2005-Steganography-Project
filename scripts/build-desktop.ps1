[CmdletBinding()]
param(
    [string]$Python = (Join-Path $PSScriptRoot "..\.venv\Scripts\python.exe")
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonCommand = (Get-Command $Python -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$npmCommand = (Get-Command npm.cmd -CommandType Application -ErrorAction Stop).Source

Push-Location (Join-Path $projectRoot "frontend")
try {
    & $npmCommand run build
    if ($LASTEXITCODE -ne 0) {
        throw "Frontend build failed (exit code $LASTEXITCODE)."
    }

    Set-Location $projectRoot
    & $pythonCommand -m PyInstaller --noconfirm Stegloc.spec
    if ($LASTEXITCODE -ne 0) {
        throw "Desktop build failed (exit code $LASTEXITCODE)."
    }

    Write-Host "Built $(Join-Path $projectRoot 'dist\Stegloc\Stegloc.exe'). Distribute the entire Stegloc folder."
}
finally {
    Pop-Location
}
