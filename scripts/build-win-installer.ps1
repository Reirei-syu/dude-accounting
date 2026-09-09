$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$releaseOutput = 'D:\coding\completed\dude-app'

Set-Location $repoRoot

Write-Host "Repository: $repoRoot"
Write-Host "Installer output: $releaseOutput"

& (Join-Path $PSScriptRoot 'prepare-cli-release-e2e.ps1')
New-Item -ItemType Directory -Force -Path $releaseOutput | Out-Null

$version = (Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+([-.][a-zA-Z0-9.-]+)?$') { throw '版本号不合法。' }
$installerName = "dude-app-$version-setup.exe"
$artifactNames = @($installerName, "$installerName.blockmap", 'latest.yml', 'builder-debug.yml', 'builder-effective-config.yaml')
foreach ($name in $artifactNames) {
  $target = [IO.Path]::GetFullPath((Join-Path $releaseOutput $name))
  if ([IO.Path]::GetDirectoryName($target) -ne $releaseOutput) { throw '产物路径越界。' }
  if (Test-Path -LiteralPath $target) {
    $item = Get-Item -LiteralPath $target
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw '产物不是普通文件。' }
    Move-Item -LiteralPath $target -Destination ($target + '.previous-' + [Guid]::NewGuid().ToString('N'))
  }
}

npm.cmd run build
if ($LASTEXITCODE -ne 0) {
  throw "Build step failed with exit code $LASTEXITCODE."
}

npm.cmd run build:cli-host:win
if ($LASTEXITCODE -ne 0) {
  throw "CLI host build failed with exit code $LASTEXITCODE."
}

npx.cmd electron-builder --win nsis --publish never
if ($LASTEXITCODE -ne 0) {
  throw "Windows installer build failed with exit code $LASTEXITCODE."
}

$installer = Get-Item -LiteralPath (Join-Path $releaseOutput $installerName) -ErrorAction SilentlyContinue
if (-not $installer) {
  throw 'Windows installer was not generated.'
}

Write-Host "Windows installer build completed: $($installer.FullName)"
Write-Host '已保留 installer、win-unpacked、校验元数据及原有产物。'
