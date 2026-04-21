$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$releaseOutput = 'D:\coding\completed\dude-app'

Set-Location $repoRoot
New-Item -ItemType Directory -Force -Path $releaseOutput | Out-Null

Write-Host "Repository: $repoRoot"
Write-Host "Installer output: $releaseOutput"

$staleArtifacts = @(
  (Join-Path $releaseOutput '*-setup.exe'),
  (Join-Path $releaseOutput '*-setup.exe.blockmap'),
  (Join-Path $releaseOutput 'latest*.yml'),
  (Join-Path $releaseOutput 'builder-debug.yml')
)

foreach ($pattern in $staleArtifacts) {
  Get-ChildItem -Path $pattern -File -ErrorAction SilentlyContinue | Remove-Item -Force
}

Get-ChildItem -Path (Join-Path $releaseOutput 'win-unpacked') -ErrorAction SilentlyContinue |
  Remove-Item -Recurse -Force

npm run build
if ($LASTEXITCODE -ne 0) {
  throw "Build step failed with exit code $LASTEXITCODE."
}

npm run build:cli-host:win
if ($LASTEXITCODE -ne 0) {
  throw "CLI host build failed with exit code $LASTEXITCODE."
}

npx electron-builder --win nsis --publish never
if ($LASTEXITCODE -ne 0) {
  throw "Windows installer build failed with exit code $LASTEXITCODE."
}

$installer = Get-ChildItem -Path $releaseOutput -Filter '*-setup.exe' -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $installer) {
  throw 'Windows installer was not generated.'
}

$itemsToRemove = Get-ChildItem -Path $releaseOutput -Force -ErrorAction SilentlyContinue |
  Where-Object {
    if ($_.PSIsContainer) {
      return $true
    }

    return $_.FullName -ne $installer.FullName
  }

foreach ($item in $itemsToRemove) {
  if ($item.PSIsContainer) {
    Remove-Item -Path $item.FullName -Recurse -Force -ErrorAction SilentlyContinue
  } else {
    Remove-Item -Path $item.FullName -Force -ErrorAction SilentlyContinue
  }
}

Write-Host "Windows installer build completed: $($installer.FullName)"
Write-Host "Only installer retained in output directory."
