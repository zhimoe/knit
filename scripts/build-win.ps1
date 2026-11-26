# Windows release build & packaging script (docs/03 §8, docs/07 M5.5).
#
# Prerequisites (MinGW-w64 / MSYS2, matching nimi's gcc — do not mix MSVC):
#   - Nim 2.x + gcc (MinGW x86_64)
#   - bun (or node) for web/dist
#   - static libgit2 under $env:LIBGIT2_PREFIX (e.g. C:\msys64\mingw64)
#   - WebView2Loader.dll in $env:WEBVIEW2_LOADER (or copied from nimi/mygo)
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/build-win.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "[1/4] Building frontend..."
Push-Location web
bun run build
npx tsc --noEmit
Pop-Location

Write-Host "[2/4] Compiling knit.exe (static libgit2, --mm:refc --threads:on)..."
New-Item -ItemType Directory -Force -Path dist | Out-Null

$nimArgs = @(
  "c",
  "-d:release",
  "-d:knitLibgit2Static",
  "--app:gui",
  "--hints:off",
  "--path:../nimi/src",
  "-o:dist/knit.exe",
  "src/main.nim"
)
& nim @nimArgs
if ($LASTEXITCODE -ne 0) { throw "nim build failed" }

Write-Host "[3/4] Copying resources & WebView2Loader..."
$resDir = Join-Path $Root "dist\resources\web\dist"
if (Test-Path $resDir) { Remove-Item -Recurse -Force $resDir }
New-Item -ItemType Directory -Force -Path $resDir | Out-Null
Copy-Item -Recurse -Force "web\dist\*" $resDir

$loaderCandidates = @(
  $env:WEBVIEW2_LOADER,
  "..\nimi\dist\WebView2Loader.dll",
  "..\nimi\mygo\WebView2Loader.dll"
) | Where-Object { $_ -and (Test-Path $_) }

if ($loaderCandidates.Count -gt 0) {
  Copy-Item -Force $loaderCandidates[0] "dist\WebView2Loader.dll"
  Write-Host "  copied WebView2Loader.dll from $($loaderCandidates[0])"
} else {
  Write-Warning "WebView2Loader.dll not found automatically; set WEBVIEW2_LOADER before packaging."
}

Write-Host "[4/4] Verifying binary size budget (<= 12 MB)..."
$exeSize = (Get-Item "dist\knit.exe").Length
$mb = [Math]::Round($exeSize / 1MB, 2)
Write-Host "  dist/knit.exe = $mb MB"
if ($exeSize -gt 12MB) {
  Write-Warning "dist/knit.exe exceeds 12 MB budget ($mb MB); check debug symbols or CRT linkage."
}
Write-Host "Done. Next: compile installer/knit.iss with Inno Setup (ISCC.exe)."
