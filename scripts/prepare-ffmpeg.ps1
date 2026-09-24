[CmdletBinding()]
param()
$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$cache = Join-Path $projectRoot "build\ffmpeg-download"
$target = Join-Path $projectRoot "build\ffmpeg"
$archive = Join-Path $cache "ffmpeg-8.1.2-essentials_build.zip"
$expected = "db580001caa24ac104c8cb856cd113a87b0a443f7bdf47d8c12b1d740584a2ec"
if ((Test-Path (Join-Path $target "ffmpeg.exe")) -and (Test-Path (Join-Path $target "ffprobe.exe"))) { return }
New-Item -ItemType Directory -Force -Path $cache, $target | Out-Null
if (-not (Test-Path $archive)) {
    Invoke-WebRequest -Uri "https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-8.1.2-essentials_build.zip" -OutFile $archive
}
$actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant()
if ($actual -ne $expected) { throw "FFmpeg archive SHA-256 mismatch; refusing to package it." }
$expanded = Join-Path $cache "expanded"
New-Item -ItemType Directory -Force -Path $expanded | Out-Null
Expand-Archive -LiteralPath $archive -DestinationPath $expanded -Force
foreach ($name in @("ffmpeg.exe", "ffprobe.exe")) {
    $candidate = Get-ChildItem -LiteralPath $expanded -Recurse -File -Filter $name | Select-Object -First 1
    if (-not $candidate) { throw "Pinned FFmpeg archive is missing $name" }
    Copy-Item -LiteralPath $candidate.FullName -Destination (Join-Path $target $name)
}
$licenseFiles = Get-ChildItem -LiteralPath $expanded -Recurse -File | Where-Object { $_.Name -match '^(LICENSE|COPYING)' }
foreach ($item in $licenseFiles) {
    Copy-Item -LiteralPath $item.FullName -Destination (Join-Path $target ("notice-" + $item.Name)) -Force
}
"FFmpeg 8.1.2 essentials build (Gyan Doshi), GPLv3. Source: https://www.gyan.dev/ffmpeg/builds/" |
    Set-Content -LiteralPath (Join-Path $target "SOURCE.txt")
