$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$releaseOutput = 'D:\coding\completed\dude-app'

Set-Location $repoRoot
New-Item -ItemType Directory -Force -Path $releaseOutput | Out-Null

Write-Host "Repository: $repoRoot"
Write-Host "Installer output: $releaseOutput"

npm run build
npx electron-builder --win nsis --publish never

Write-Host 'Windows installer build completed.'
