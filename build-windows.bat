@echo off
setlocal EnableExtensions
pushd "%~dp0" || exit /b 1

powershell.exe -NoProfile -NonInteractive -Command "if (Test-Path 'dist\Stegloc\Stegloc.exe') { $exe=(Resolve-Path 'dist\Stegloc\Stegloc.exe').Path; if (Get-Process -Name Stegloc -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe }) { Write-Host 'Close the running Stegloc app before rebuilding it.'; exit 1 } }"
if errorlevel 1 goto :failed

if not exist ".venv\Scripts\python.exe" (
    echo Creating Python virtual environment...
    where py >nul 2>&1
    if not errorlevel 1 (
        py -3 -m venv .venv
    ) else (
        where python >nul 2>&1 || goto :missing_python
        python -m venv .venv
    )
    if errorlevel 1 goto :failed
)

set "PYTHON=%CD%\.venv\Scripts\python.exe"
"%PYTHON%" -c "import sys; sys.exit(sys.version_info < (3, 11))"
if errorlevel 1 (
    echo Python 3.11 or newer is required. Remove .venv and install a supported Python version.
    goto :failed
)
where node.exe >nul 2>&1 || goto :missing_node
where npm.cmd >nul 2>&1 || goto :missing_node
node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit((major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major > 22 ? 0 : 1)"
if errorlevel 1 (
    echo Node.js 20.19+ or 22.12+ is required.
    goto :failed
)

echo Installing Python dependencies...
"%PYTHON%" -m pip install --disable-pip-version-check -r requirements.lock || goto :failed
"%PYTHON%" -m pip install --disable-pip-version-check setuptools==84.0.0 || goto :failed
"%PYTHON%" -m pip install --disable-pip-version-check --no-build-isolation ".[desktop,build]" || goto :failed

echo Installing frontend dependencies...
call npm.cmd ci --prefix frontend || goto :failed

echo Preparing pinned FFmpeg binaries...
powershell.exe -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop'; $target='build\ffmpeg'; $cache='build\ffmpeg-download'; $archive=Join-Path $cache 'ffmpeg-8.1.2-essentials_build.zip'; if (!(Test-Path (Join-Path $target 'ffmpeg.exe')) -or !(Test-Path (Join-Path $target 'ffprobe.exe'))) { New-Item -ItemType Directory -Force -Path $cache,$target | Out-Null; if (!(Test-Path $archive)) { Invoke-WebRequest 'https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-8.1.2-essentials_build.zip' -OutFile $archive }; if ((Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant() -ne 'db580001caa24ac104c8cb856cd113a87b0a443f7bdf47d8c12b1d740584a2ec') { throw 'FFmpeg archive SHA-256 mismatch' }; $expanded=Join-Path $cache 'expanded'; Expand-Archive -LiteralPath $archive -DestinationPath $expanded -Force; foreach ($name in @('ffmpeg.exe','ffprobe.exe')) { $candidate=Get-ChildItem -LiteralPath $expanded -Recurse -File -Filter $name | Select-Object -First 1; if (!$candidate) { throw ('FFmpeg archive is missing ' + $name) }; Copy-Item -LiteralPath $candidate.FullName -Destination (Join-Path $target $name) -Force }; Get-ChildItem -LiteralPath $expanded -Recurse -File | Where-Object { $_.Name -match '^(LICENSE|COPYING)' } | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $target ('notice-' + $_.Name)) -Force }; 'FFmpeg 8.1.2 essentials build (Gyan Doshi), GPLv3. Source: https://www.gyan.dev/ffmpeg/builds/' | Set-Content -LiteralPath (Join-Path $target 'SOURCE.txt') }"
if errorlevel 1 goto :failed

echo Building frontend...
call npm.cmd run build --prefix frontend || goto :failed

echo Packaging Windows app...
"%PYTHON%" -m PyInstaller --noconfirm Stegloc.spec || goto :failed
if not exist "dist\Stegloc\Stegloc.exe" goto :failed

echo.
echo Built dist\Stegloc\Stegloc.exe
echo Distribute the entire dist\Stegloc folder.
popd
exit /b 0

:missing_python
echo Python 3.11 or newer is required. Install Python and rerun this script.
goto :failed

:missing_node
echo Node.js 20.19+ or 22.12+ with npm is required. Install Node.js and rerun this script.
goto :failed

:failed
echo Windows build failed. Review the error above and rerun build-windows.bat.
popd
exit /b 1
